package secrets

import (
	"crypto/aes"
	"crypto/cipher"
	"encoding/base64"
	"encoding/json"
	"os"
	"testing"

	"github.com/saurlax/sauryctf/apps/worker/internal/contracts"
	"github.com/saurlax/sauryctf/apps/worker/internal/providers"
)

func TestKeyringDecryptsBoundEnvelope(t *testing.T) {
	keyMaterial := []byte("0123456789abcdef0123456789abcdef")
	keyring, err := NewKeyring(map[string][]byte{"worker-key-v1": keyMaterial})
	if err != nil {
		t.Fatal(err)
	}
	key := testInstanceKey()
	envelope := sealForTest(t, keyMaterial, "worker-key-v1", key, secretPlaintext(t,
		plaintextEnvironmentItem{Name: "SAURYCTF_FLAG", Value: []byte("flag{sealed-runtime}")},
	))
	environment, err := keyring.Decrypt(envelope, key)
	if err != nil {
		t.Fatalf("Decrypt() error = %v", err)
	}
	if len(environment) != 1 || environment[0].Name != "SAURYCTF_FLAG" || string(environment[0].Value) != "flag{sealed-runtime}" {
		t.Fatalf("environment = %+v", environment)
	}
}

func TestDecryptsSharedTypeScriptJobFixture(t *testing.T) {
	raw, err := os.ReadFile("../../../../contracts/fixtures/instance-jobs/v1/ensure.json")
	if err != nil {
		t.Fatal(err)
	}
	job, err := contracts.DecodeInstanceJob(raw)
	if err != nil {
		t.Fatal(err)
	}
	payload, ok := job.Payload.(*contracts.EnsureInstanceJobPayload)
	if !ok || payload.Spec.SecretEnvelope == nil {
		t.Fatalf("ensure fixture payload = %#v", job.Payload)
	}
	keyring, _ := ParseKeyringJSON(`{"worker-key-v1":"MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY"}`)
	key := testInstanceKey()
	key.Instance = job.InstanceID
	key.Generation = job.DesiredGeneration
	environment, err := keyring.Decrypt(*payload.Spec.SecretEnvelope, key)
	if err != nil {
		t.Fatalf("Decrypt(shared fixture) error = %v", err)
	}
	if len(environment) != 1 || environment[0].Name != "SAURYCTF_FLAG" || string(environment[0].Value) != "flag{encrypted-for-worker}" {
		t.Fatalf("shared fixture environment = %+v", environment)
	}
}

func TestKeyringRejectsTamperingAndCrossInstanceReplay(t *testing.T) {
	keyMaterial := []byte("0123456789abcdef0123456789abcdef")
	keyring, _ := NewKeyring(map[string][]byte{"worker-key-v1": keyMaterial})
	key := testInstanceKey()
	envelope := sealForTest(t, keyMaterial, "worker-key-v1", key, secretPlaintext(t,
		plaintextEnvironmentItem{Name: "SAURYCTF_FLAG", Value: []byte("flag{sealed-runtime}")},
	))

	tampered, _ := base64.StdEncoding.DecodeString(envelope.CiphertextBase64)
	tampered[len(tampered)-1] ^= 1
	envelope.CiphertextBase64 = base64.StdEncoding.EncodeToString(tampered)
	if _, err := keyring.Decrypt(envelope, key); err == nil {
		t.Fatal("Decrypt() accepted tampered ciphertext")
	}

	envelope = sealForTest(t, keyMaterial, "worker-key-v1", key, secretPlaintext(t,
		plaintextEnvironmentItem{Name: "SAURYCTF_FLAG", Value: []byte("flag{sealed-runtime}")},
	))
	key.Generation++
	if _, err := keyring.Decrypt(envelope, key); err == nil {
		t.Fatal("Decrypt() accepted a replay for another generation")
	}
}

func TestKeyringRejectsUnreservedOrDuplicateSecretNames(t *testing.T) {
	keyMaterial := []byte("0123456789abcdef0123456789abcdef")
	keyring, _ := NewKeyring(map[string][]byte{"worker-key-v1": keyMaterial})
	key := testInstanceKey()
	for _, plaintext := range [][]byte{
		secretPlaintext(t, plaintextEnvironmentItem{Name: "FLAG", Value: []byte("flag{bad}")}),
		secretPlaintext(t,
			plaintextEnvironmentItem{Name: "SAURYCTF_FLAG", Value: []byte("one")},
			plaintextEnvironmentItem{Name: "SAURYCTF_FLAG", Value: []byte("two")},
		),
	} {
		if _, err := keyring.Decrypt(sealForTest(t, keyMaterial, "worker-key-v1", key, plaintext), key); err == nil {
			t.Fatalf("Decrypt() accepted plaintext %s", string(plaintext))
		}
	}
}

func secretPlaintext(t *testing.T, environment ...plaintextEnvironmentItem) []byte {
	t.Helper()
	value, err := json.Marshal(plaintextPayload{Schema: plaintextSchema, Environment: environment})
	if err != nil {
		t.Fatal(err)
	}
	return value
}

func TestParseKeyringJSONUsesStrictBase64URLKeys(t *testing.T) {
	keyring, err := ParseKeyringJSON(`{"worker-key-v1":"MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY"}`)
	if err != nil || keyring == nil {
		t.Fatalf("ParseKeyringJSON() = %+v/%v", keyring, err)
	}
	if _, err := ParseKeyringJSON(`{"worker-key-v1":"short"}`); err == nil {
		t.Fatal("ParseKeyringJSON() accepted an invalid key")
	}
}

func sealForTest(t *testing.T, keyMaterial []byte, keyID string, key providers.InstanceKey, plaintext []byte) contracts.InstanceSecretEnvelope {
	t.Helper()
	dataKey := []byte("abcdef0123456789abcdef0123456789")
	wrapNonce := []byte("wrap-nonce01")
	payloadNonce := []byte("data-nonce01")
	wrapped := sealGCMForTest(t, keyMaterial, wrapNonce, dataKey, wrapAAD(keyID))
	payload := sealGCMForTest(t, dataKey, payloadNonce, plaintext, payloadAAD(key))
	blob := append([]byte(nil), envelopeMagic...)
	blob = append(blob, wrapNonce...)
	blob = append(blob, payloadNonce...)
	blob = append(blob, wrapped...)
	blob = append(blob, payload...)
	return contracts.InstanceSecretEnvelope{Schema: envelopeSchema, KeyID: keyID, CiphertextBase64: base64.StdEncoding.EncodeToString(blob)}
}

func sealGCMForTest(t *testing.T, key, nonce, plaintext, aad []byte) []byte {
	t.Helper()
	block, err := aes.NewCipher(key)
	if err != nil {
		t.Fatal(err)
	}
	aead, err := cipher.NewGCM(block)
	if err != nil {
		t.Fatal(err)
	}
	return aead.Seal(nil, nonce, plaintext, aad)
}

func testInstanceKey() providers.InstanceKey {
	return providers.InstanceKey{
		Platform: "sauryctf", Provider: contracts.ProviderDocker,
		Contest: "018f47a2-4ef8-7e2c-9c24-6d68b7451021", Challenge: "018f47a2-4ef8-7e2c-9c24-6d68b7451031",
		Team: "018f47a2-4ef8-7e2c-9c24-6d68b7451051", Instance: "018f47a2-4ef8-7e2c-9c24-6d68b7451001", Generation: 7,
	}
}
