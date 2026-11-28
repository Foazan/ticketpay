// Unit tests for the ID name matcher: `pnpm --filter @ticketpay/web test:unit`.
// The card texts imitate OCR output of a fictional KTP, misreads included.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { compareIdName, extractName } from './id-name-match';

const card = (name: string) =>
  ['PROVINSI JAWA TIMUR', 'KOTA MALANG', 'NIK : 3573000000000001', `Nama : ${name}`, 'Tempat/Tgl Lahir : MALANG, 01-01-2001', 'Jenis Kelamin : PEREMPUAN'].join('\n');

const cases: [holder: string, text: string, outcome: string][] = [
  ['Rania Putri', card('RANIA PUTRI'), 'MATCH'],
  ['Rania Putri', card('RAN1A PUTRl'), 'MATCH'], // digit and lower-case L read for I
  ['Rania Putri', 'Narna : RANIA PUTRI', 'MATCH'], // misread label
  ['Rania Putri', 'NIK 3573\nNama\nRANIA PUTRI\nTempat', 'MATCH'], // value on the next line
  ['Muhammad Rizky', card('MUHAMAD RIZKY'), 'MATCH'], // one letter off
  ['Dewi Anggraini Lestari', card('DEW ANGGRAINI LES TARY'), 'MATCH'], // a word split in two
  ['Rania Putri', card('RANIA PUTRI SALSABILA'), 'PARTIAL'], // the card has an extra name
  ['Rania Putri', card('BUDI RANIA'), 'PARTIAL'],
  ['Rania Putri', card('BIMA SANTOSO'), 'NO_MATCH'],
  ['Rania Putri', 'blurry ~~', 'UNREADABLE'],
];

for (const [holder, text, outcome] of cases) {
  test(`${holder} vs "${text.split('\n').find((l) => /nama|narna/i.test(l)) ?? text}" → ${outcome}`, () => {
    assert.equal(compareIdName(holder, text).outcome, outcome);
  });
}

test('only the name is extracted, never the ID number', () => {
  assert.equal(extractName(card('DEWI ANGGRAINI')), 'DEWI ANGGRAINI');
  const r = compareIdName('Rania Putri', card('RANIA PUTRI'));
  assert.ok(!JSON.stringify(r).includes('3573'));
});
