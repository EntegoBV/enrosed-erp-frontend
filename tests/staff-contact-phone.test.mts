import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizedStaffPhone, staffPhoneError } from '../src/app/shared/staff-contact-phone.ts';

test('both Belgian account numbers and common international formatting can be saved', () => {
  for (const phone of ['+32 456 54 78 55', '+32 (0) 456-54-78-55', '020.123.4567', '+441234567890123']) {
    assert.equal(staffPhoneError(phone), null, phone);
  }
});

test('an intentionally empty number clears the account contact instead of sending spaces', () => {
  for (const phone of ['', '   ']) {
    assert.equal(normalizedStaffPhone(phone), null);
    assert.equal(staffPhoneError(phone), null);
  }
  assert.equal(normalizedStaffPhone(null), null);
  assert.equal(normalizedStaffPhone('  +32 456 54 78 55  '), '+32 456 54 78 55');
});

test('invalid or overlong numbers cannot be submitted as catalogue contact details', () => {
  for (const phone of ['123456', '1234567890123456', 'Bel Berat', '1234567/8', '++32456547855', '32+456547855', '+32' + ' '.repeat(50) + '456547855']) {
    assert.ok(staffPhoneError(phone), phone);
  }
});
