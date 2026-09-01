// Package contracts defines the versioned JSON boundary shared with the Nuxt
// control plane. These types reject values that JavaScript cannot preserve.
package contracts

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"regexp"
	"strconv"
	"time"
)

const MaxSafeContractInteger int64 = 9007199254740991

var canonicalUUID = regexp.MustCompile(`^[0-9a-f]{8}-[0-9a-f]{4}-[0-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$`)
var canonicalUTCTimestamp = regexp.MustCompile(`^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$`)

type UUID string

func (value UUID) Validate() error {
	if !canonicalUUID.MatchString(string(value)) {
		return errors.New("UUID must use canonical lower-case RFC representation")
	}
	return nil
}

func (value UUID) MarshalJSON() ([]byte, error) {
	if err := value.Validate(); err != nil {
		return nil, err
	}
	return json.Marshal(string(value))
}

func (value *UUID) UnmarshalJSON(data []byte) error {
	var raw string
	if err := json.Unmarshal(data, &raw); err != nil {
		return fmt.Errorf("decode UUID: %w", err)
	}
	parsed := UUID(raw)
	if err := parsed.Validate(); err != nil {
		return err
	}
	*value = parsed
	return nil
}

type UTCTimestamp string

func (value UTCTimestamp) Validate() error {
	if !canonicalUTCTimestamp.MatchString(string(value)) {
		return errors.New("UTC timestamp must use canonical millisecond representation")
	}
	if _, err := time.Parse("2006-01-02T15:04:05.000Z", string(value)); err != nil {
		return fmt.Errorf("parse UTC timestamp: %w", err)
	}
	return nil
}

func NewUTCTimestamp(value time.Time) UTCTimestamp {
	return UTCTimestamp(value.UTC().Truncate(time.Millisecond).Format("2006-01-02T15:04:05.000Z"))
}

func (value UTCTimestamp) Time() (time.Time, error) {
	if err := value.Validate(); err != nil {
		return time.Time{}, err
	}
	return time.Parse("2006-01-02T15:04:05.000Z", string(value))
}

func (value UTCTimestamp) MarshalJSON() ([]byte, error) {
	if err := value.Validate(); err != nil {
		return nil, err
	}
	return json.Marshal(string(value))
}

func (value *UTCTimestamp) UnmarshalJSON(data []byte) error {
	var raw string
	if err := json.Unmarshal(data, &raw); err != nil {
		return fmt.Errorf("decode UTC timestamp: %w", err)
	}
	parsed := UTCTimestamp(raw)
	if err := parsed.Validate(); err != nil {
		return err
	}
	*value = parsed
	return nil
}

type Score int64

func (value Score) Validate() error {
	if int64(value) < -MaxSafeContractInteger || int64(value) > MaxSafeContractInteger {
		return errors.New("score exceeds the lossless JSON integer range")
	}
	return nil
}

func (value Score) MarshalJSON() ([]byte, error) {
	if err := value.Validate(); err != nil {
		return nil, err
	}
	return []byte(strconv.FormatInt(int64(value), 10)), nil
}

func (value *Score) UnmarshalJSON(data []byte) error {
	parsed, err := parseContractInteger(data)
	if err != nil {
		return fmt.Errorf("decode score: %w", err)
	}
	score := Score(parsed)
	if err := score.Validate(); err != nil {
		return err
	}
	*value = score
	return nil
}

type ResourceVersion uint64

func (value ResourceVersion) Validate() error {
	if value == 0 || uint64(value) > uint64(MaxSafeContractInteger) {
		return errors.New("resource version must be a positive lossless JSON integer")
	}
	return nil
}

func (value ResourceVersion) MarshalJSON() ([]byte, error) {
	if err := value.Validate(); err != nil {
		return nil, err
	}
	return []byte(strconv.FormatUint(uint64(value), 10)), nil
}

func (value *ResourceVersion) UnmarshalJSON(data []byte) error {
	parsed, err := parseContractInteger(data)
	if err != nil {
		return fmt.Errorf("decode resource version: %w", err)
	}
	if parsed < 0 {
		return errors.New("resource version cannot be negative")
	}
	version := ResourceVersion(parsed)
	if err := version.Validate(); err != nil {
		return err
	}
	*value = version
	return nil
}

func parseContractInteger(data []byte) (int64, error) {
	decoder := json.NewDecoder(bytes.NewReader(data))
	decoder.UseNumber()
	var value json.Number
	if err := decoder.Decode(&value); err != nil {
		return 0, err
	}
	parsed, err := strconv.ParseInt(value.String(), 10, 64)
	if err != nil {
		return 0, errors.New("value must be a base-10 JSON integer")
	}
	return parsed, nil
}
