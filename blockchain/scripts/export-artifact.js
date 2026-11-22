// Copies the compiled ABI and bytecode into export/, the only thing the API imports from this package.
const { mkdirSync, readFileSync, writeFileSync } = require('node:fs');
const { resolve } = require('node:path');

const artifact = JSON.parse(readFileSync(resolve(__dirname, '../artifacts/contracts/TicketPayTicket.sol/TicketPayTicket.json'), 'utf8'));
const out = resolve(__dirname, '../export');
mkdirSync(out, { recursive: true });
writeFileSync(resolve(out, 'TicketPayTicket.json'), JSON.stringify({ contractName: artifact.contractName, abi: artifact.abi, bytecode: artifact.bytecode }, null, 2) + '\n');
writeFileSync(
  resolve(out, 'index.js'),
  "const artifact = require('./TicketPayTicket.json');\nmodule.exports = { TicketPayTicketArtifact: artifact, TICKET_PAY_TICKET_ABI: artifact.abi };\n",
);
writeFileSync(
  resolve(out, 'index.d.ts'),
  'export declare const TicketPayTicketArtifact: { contractName: string; abi: readonly unknown[]; bytecode: string };\nexport declare const TICKET_PAY_TICKET_ABI: readonly unknown[];\n',
);
console.log(`Exported ABI and bytecode to ${out}`);
