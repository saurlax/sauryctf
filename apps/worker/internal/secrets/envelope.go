// Package secrets decrypts authenticated instance runtime payloads without
// exposing their plaintext to task contracts, logs, or resource metadata.
package secrets

import (
	"bytes"
	"crypto/aes"
	"crypto/cipher"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"strconv"

	"github.com/saurlax/sauryctf/apps/worker/internal/contracts"
	"github.com/saurlax/sauryctf/apps/worker/internal/providers"
)

const (
	envelopeSchema        = "instance-secrets.v1"
	plaintextSchema       = "instance-runtime-secrets.v1"
	nonceSize             = 12
	wrappedDataKeySize    = 32 + 16
	minimumCiphertextSize = 5 + nonceSize + nonceSize + wrappedDataKeySize + 16
)

var envelopeMagic = []byte{'S', 'C', 'T', 'F', 1}

type Keyring struct {
	keys map[string][32]byte
}

func (*Keyring) String() string { return "<redacted instance secret keyring>" }

func NewKeyring(keys map[string][]byte) (*Keyring, error) {
	if len(keys) == 0 {
		return nil, errors.New("instance secret keyring must not be empty")
	}
	keyring := &Keyring{keys: make(map[string][32]byte, len(keys))}
	for keyID, material := range keys {
		envelope := contracts.InstanceSecretEnvelope{Schema: envelopeSchema, KeyID: keyID, CiphertextBase64: "AAAA"}
		if err := envelope.Validate(); err != nil {
			return nil, fmt.Errorf("invalid instance secret key id: %w", err)
		}
		if len(material) != 32 {
			return nil, fmt.Errorf("instance secret key %q must contain exactly 32 bytes", keyID)
		}
		var key [32]byte
		copy(key[:], material)
		keyring.keys[keyID] = key
	}
	return keyring, nil
}

// ParseKeyringJSON accepts a JSON object whose values are unpadded base64url
// encoded 32-byte AES keys. It is intended for deployment Secret values.
func ParseKeyringJSON(raw string) (*Keyring, error) {
	var encoded map[string]string
	decoder := json.NewDecoder(bytes.NewBufferString(raw))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&encoded); err != nil {
		return nil, errors.New("INSTANCE_SECRET_KEYS must be a JSON object")
	}
	if err := requireJSONEOF(decoder); err != nil {
		return nil, errors.New("INSTANCE_SECRET_KEYS must contain one JSON object")
	}
	decoded := make(map[string][]byte, len(encoded))
	for keyID, value := range encoded {
		key, err := base64.RawURLEncoding.Strict().DecodeString(value)
		if err != nil {
			return nil, fmt.Errorf("instance secret key %q must use unpadded base64url", keyID)
		}
		decoded[keyID] = key
	}
	keyring, err := NewKeyring(decoded)
	for _, key := range decoded {
		clearBytes(key)
	}
	return keyring, err
}

func (keyring *Keyring) Decrypt(envelope contracts.InstanceSecretEnvelope, key providers.InstanceKey) ([]providers.SensitiveEnvironmentVariable, error) {
	if keyring == nil {
		return nil, errors.New("instance secret keyring is not configured")
	}
	if err := envelope.Validate(); err != nil {
		return nil, errors.New("instance secret envelope is invalid")
	}
	if err := key.Validate(); err != nil {
		return nil, errors.New("instance secret identity is invalid")
	}
	keyEncryptionKey, exists := keyring.keys[envelope.KeyID]
	if !exists {
		return nil, errors.New("instance secret envelope uses an unavailable key")
	}
	blob, err := base64.StdEncoding.Strict().DecodeString(envelope.CiphertextBase64)
	if err != nil || len(blob) < minimumCiphertextSize || !bytes.Equal(blob[:len(envelopeMagic)], envelopeMagic) {
		return nil, errors.New("instance secret envelope ciphertext is invalid")
	}

	offset := len(envelopeMagic)
	wrapNonce := blob[offset : offset+nonceSize]
	offset += nonceSize
	payloadNonce := blob[offset : offset+nonceSize]
	offset += nonceSize
	wrappedDataKey := blob[offset : offset+wrappedDataKeySize]
	offset += wrappedDataKeySize
	payloadCiphertext := blob[offset:]

	dataKey, err := openGCM(keyEncryptionKey[:], wrapNonce, wrappedDataKey, wrapAAD(envelope.KeyID))
	if err != nil || len(dataKey) != 32 {
		clearBytes(dataKey)
		return nil, errors.New("instance secret envelope authentication failed")
	}
	defer clearBytes(dataKey)
	plaintext, err := openGCM(dataKey, payloadNonce, payloadCiphertext, payloadAAD(key))
	if err != nil {
		return nil, errors.New("instance secret payload authentication failed")
	}
	defer clearBytes(plaintext)

	environment, err := decodePlaintext(plaintext)
	if err != nil {
		return nil, err
	}
	return environment, nil
}

type plaintextPayload struct {
	Schema      string                     `json:"schema"`
	Environment []plaintextEnvironmentItem `json:"environment"`
}

type plaintextEnvironmentItem struct {
	Name  string `json:"name"`
	Value []byte `json:"value_base64"`
}

func decodePlaintext(value []byte) ([]providers.SensitiveEnvironmentVariable, error) {
	var payload plaintextPayload
	decoder := json.NewDecoder(bytes.NewReader(value))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&payload); err != nil || requireJSONEOF(decoder) != nil {
		clearPlaintextEnvironment(payload.Environment)
		return nil, errors.New("instance secret plaintext is invalid")
	}
	if payload.Schema != plaintextSchema || len(payload.Environment) < 1 || len(payload.Environment) > 32 {
		clearPlaintextEnvironment(payload.Environment)
		return nil, errors.New("instance secret plaintext schema is invalid")
	}
	environment := make([]providers.SensitiveEnvironmentVariable, 0, len(payload.Environment))
	for _, item := range payload.Environment {
		variable := providers.SensitiveEnvironmentVariable{Name: item.Name, Value: item.Value}
		if err := variable.Validate(); err != nil {
			clearSensitive(environment)
			clearPlaintextEnvironment(payload.Environment)
			return nil, errors.New("instance secret plaintext contains an invalid variable")
		}
		for _, existing := range environment {
			if existing.Name == variable.Name {
				clearSensitive(environment)
				clearPlaintextEnvironment(payload.Environment)
				return nil, errors.New("instance secret plaintext contains duplicate variables")
			}
		}
		environment = append(environment, variable)
	}
	return environment, nil
}

func clearPlaintextEnvironment(environment []plaintextEnvironmentItem) {
	for index := range environment {
		clearBytes(environment[index].Value)
	}
}

func openGCM(key, nonce, ciphertext, associatedData []byte) ([]byte, error) {
	block, err := aes.NewCipher(key)
	if err != nil {
		return nil, err
	}
	aead, err := cipher.NewGCM(block)
	if err != nil {
		return nil, err
	}
	if len(nonce) != aead.NonceSize() {
		return nil, errors.New("invalid nonce")
	}
	return aead.Open(nil, nonce, ciphertext, associatedData)
}

func wrapAAD(keyID string) []byte {
	return []byte("sauryctf/instance-secrets.v1/wrap/" + keyID)
}

func payloadAAD(key providers.InstanceKey) []byte {
	return []byte("sauryctf/instance-secrets.v1/payload\n" + key.Platform + "\n" + string(key.Provider) + "\n" +
		string(key.Contest) + "\n" + string(key.Challenge) + "\n" + string(key.Team) + "\n" +
		string(key.Instance) + "\n" + strconv.FormatUint(uint64(key.Generation), 10))
}

func requireJSONEOF(decoder *json.Decoder) error {
	var extra any
	err := decoder.Decode(&extra)
	if errors.Is(err, io.EOF) {
		return nil
	}
	if err == nil {
		return errors.New("unexpected trailing JSON value")
	}
	return err
}

func clearSensitive(environment []providers.SensitiveEnvironmentVariable) {
	for index := range environment {
		clearBytes(environment[index].Value)
	}
}

func clearBytes(value []byte) {
	for index := range value {
		value[index] = 0
	}
}
