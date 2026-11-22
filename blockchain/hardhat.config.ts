import '@nomicfoundation/hardhat-toolbox';
import { config as loadEnv } from 'dotenv';
import { subtask, type HardhatUserConfig } from 'hardhat/config';
import { TASK_COMPILE_SOLIDITY_GET_SOLC_BUILD } from 'hardhat/builtin-tasks/task-names';
import { resolve } from 'node:path';

loadEnv({ path: resolve(__dirname, '../.env') });

export const SOLC_VERSION = '0.8.28';

// Compile with the solc package from npm by default, so no compiler download from
// binaries.soliditylang.org is needed. Set HARDHAT_NATIVE_SOLC=1 to use Hardhat's own download instead.
subtask(TASK_COMPILE_SOLIDITY_GET_SOLC_BUILD, async (args: { solcVersion: string }, _hre, runSuper) => {
  if (process.env.HARDHAT_NATIVE_SOLC === '1') return runSuper(args);
  const solc = require('solc');
  if (args.solcVersion !== SOLC_VERSION) throw new Error(`The bundled solc is ${SOLC_VERSION}; ${args.solcVersion} was requested.`);
  return { compilerPath: require.resolve('solc/soljson.js'), isSolcJs: true, version: args.solcVersion, longVersion: solc.version() };
});

const sepoliaAccounts = process.env.DEPLOYER_PRIVATE_KEY ? [process.env.DEPLOYER_PRIVATE_KEY] : [];

const config: HardhatUserConfig = {
  solidity: { version: SOLC_VERSION, settings: { optimizer: { enabled: true, runs: 200 }, evmVersion: 'cancun' } },
  networks: {
    hardhat: { chainId: 31337 },
    localhost: { url: process.env.LOCAL_RPC_URL || 'http://127.0.0.1:8545', chainId: 31337 },
    sepolia: { url: process.env.SEPOLIA_RPC_URL || '', chainId: 11155111, accounts: sepoliaAccounts },
  },
  etherscan: { apiKey: process.env.ETHERSCAN_API_KEY || '' },
  sourcify: { enabled: false },
  gasReporter: { enabled: process.env.REPORT_GAS === '1', currency: 'USD' },
};

export default config;
