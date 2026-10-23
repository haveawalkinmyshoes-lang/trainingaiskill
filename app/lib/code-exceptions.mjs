import {createHash} from 'node:crypto';
import {normalizeFullName} from './access.mjs';
// Explicit owner-requested pilot exception. The hash identifies an allowlisted
// name; it is not a password or proof of identity. Anyone knowing that name can
// use its access. The server additionally checks the linked Bitrix user ID.
const exemptName='640e5f653dfdfb939b052cf16ba28ad1515d5cd700cd4bb49b8a8924758ead96';
export function codeException(person){
  return Boolean(person?.email&&createHash('sha256').update(normalizeFullName(person.fullName)).digest('hex')===exemptName);
}
export const exemptBitrixId='1546';
