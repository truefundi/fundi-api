export const RWANDA_PHONE_NUMBER_PATTERN = /^\+250(?:78|79|72|73)\d{7}$/;

const LOCAL_RWANDA_PHONE_NUMBER_PATTERN = /^0(?:78|79|72|73)\d{7}$/;

export function normalizeRwandaPhoneNumber(value: unknown): unknown {
  if (typeof value !== 'string') {
    return value;
  }

  const phoneNumber = value.replace(/[\s()-]/g, '');
  if (LOCAL_RWANDA_PHONE_NUMBER_PATTERN.test(phoneNumber)) {
    return `+250${phoneNumber.slice(1)}`;
  }

  return phoneNumber;
}
