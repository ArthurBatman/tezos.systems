// Supabase configuration
// Note: The anon key is safe to expose in client-side code
// It only allows operations permitted by Row Level Security policies

export const SUPABASE_CONFIG = {
  url: 'https://iijpfczftroespicmufb.supabase.co',
  key: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImlpanBmY3pmdHJvZXNwaWNtdWZiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzA1NDg4NjIsImV4cCI6MjA4NjEyNDg2Mn0.tbW5cum-xT-k4riiv3ysLK5D3am_3-DaBO1YO8HpaO0'
};

// API base URLs
export const API_URLS = {
  tzkt: 'https://api.tzkt.io/v1',
  octez: 'https://eu.rpc.tez.capital',
  octezMainnet: 'https://tezos-mainnet.octez.io',
  octezArchive: 'https://octez-mainnet-archive.octez.io',
  tzktArchive: 'https://rpc.tzkt.io/mainnet',
  teztale: 'https://teztale-server-mainnet-ro-prd.octez.tech',
  coingecko: 'https://api.coingecko.com/api/v3',
  defillama: 'https://api.llama.fi',
  tezlinkExplorer: 'https://explorer.etherlink.com/api/v2',
  tezlinkRpc: 'https://node.mainnet.etherlink.com'
};

// Refresh intervals (milliseconds)
export const REFRESH_INTERVALS = {
  scalar: 900000,       // 15 minutes for lightweight headline telemetry
  heavy: 7200000,       // 2 hours for full-card and directory refreshes
  sparkline: 600000,    // 10 minutes
  price: 1800000        // 30 minutes (matches price.js cache TTL)
};

// Cache TTLs (milliseconds)
export const CACHE_TTLS = {
  memory: 60000,         // 1 minute (in-memory API cache)
  storage: 14400000      // 4 hours (localStorage)
};

// Fetch limits
export const FETCH_LIMITS = {
  bakers: 10000
};

// Whale/giant thresholds (in mutez)
export const THRESHOLDS = {
  whaleMinAmount: 1000 * 1e6,       // 1,000 XTZ
  giantMinBalance: 1000000 * 1e6    // 1,000,000 XTZ (1M)
};

// Staking target percentage
export const STAKING_TARGET = 50;

// Mainnet launch date
// Tezos mainnet launched Sep 17, 2018 (not Jun 30, which was the fundraiser genesis)
export const MAINNET_LAUNCH = '2018-09-17T00:00:00Z';

// History data start date
export const HISTORY_START = '2024-01-01';

// Static comparison data for other chains (updated periodically)
export const CHAIN_COMPARISON = {
    lastUpdated: '2026-07-11',
    ethereum: {
        name: 'Ethereum',
        symbol: 'ETH',
        slashing: 'Yes',
        slashingNote: 'Protocol penalties apply',
        blockTime: '~12s',
        finality: '~15 min',
        finalityNote: '2 epochs',
        validators: 'Method varies',
        validatorsNote: 'keys are not independent entities',
        validatorsTooltip: 'Validator-key counts and independently controlled staking entities are different measurements. Consult a dated, entity-grouped source before drawing a concentration conclusion.',
        stakingPct: 'Dynamic',
        annualIssuance: 'Dynamic',
        annualIssuanceTooltip: 'Gross issuance and burn-dependent net supply change with validator participation and network activity.',
        selfAmendments: 'Social/client coordination',
        selfAmendmentsNote: 'not a Tezos-style protocol self-amendment count',
        hardForks: 'Coordinated hard-fork upgrades',
        energyPerTx: 'Proof of stake',
        energyPerTxNote: 'Post-Merge; methodology varies',
        avgTxFee: 'Variable',
        avgTxFeeTooltip: 'L1 fees vary with demand and transaction complexity.',
    },
    solana: {
        name: 'Solana',
        symbol: 'SOL',
        slashing: 'No',
        slashingNote: 'Delinquency only',
        slashingTooltip: 'No slashing implemented. Misbehaving validators become delinquent and stop earning rewards.',
        blockTime: '~0.4s',
        finality: '~12.8s',
        finalityNote: 'Finalized (31 blocks)',
        finalityTooltip: 'Confirmed (~0.4s) = 66%+ voted. Finalized (~12.8s) = 31 confirmed blocks. Showing finalized.',
        validators: 'See live sources',
        validatorsNote: 'stake concentration changes',
        stakingPct: 'Dynamic',
        annualIssuance: 'Disinflationary schedule',
        annualIssuanceTooltip: 'Protocol inflation follows a declining schedule toward a long-run floor; the live value changes over time.',
        selfAmendments: 'Client-coordinated releases',
        selfAmendmentsNote: 'not a Tezos-style protocol self-amendment count',
        hardForks: 'Client-coordinated upgrades',
        energyPerTx: '0.658 kJ/tx',
        energyPerTxNote: 'December 2023 report',
        avgTxFee: 'Variable',
    },
    cardano: {
        name: 'Cardano',
        symbol: 'ADA',
        slashing: 'No',
        slashingNote: 'No penalties',
        blockTime: '~20s',
        finality: 'Probabilistic',
        finalityNote: 'confirmation policy varies',
        validators: 'Stake pools',
        validatorsNote: 'consult a dated distribution source',
        stakingPct: 'Dynamic',
        annualIssuance: 'Reserve + fees',
        selfAmendments: 'Voltaire-era governance',
        selfAmendmentsNote: 'Chang introduced governance through the Hard Fork Combinator; it is not a Tezos-style self-amendment count',
        selfAmendmentsTooltip: 'Voltaire-era on-chain governance with DReps, Constitutional Committee, and SPO voting. Live since Chang hard fork.',
        hardForks: 'Hard fork combinator',
        energyPerTx: 'Proof of stake',
        energyPerTxNote: 'methodology varies',
        avgTxFee: 'Protocol formula',
    },
    algorand: {
        name: 'Algorand',
        symbol: 'ALGO',
        slashing: 'No',
        slashingNote: 'No penalties',
        blockTime: '~3.3s',
        blockTimeTooltip: 'Dynamic round times. Can go as low as ~2.8s under ideal conditions.',
        finality: '~3.3s',
        finalityNote: 'Instant finality',
        finalityTooltip: 'Pure Proof of Stake provides immediate deterministic finality when its consensus assumptions hold, rather than a probabilistic confirmation window.',
        validators: 'Permissionless sortition',
        validatorsNote: 'Permissionless sortition',
        validatorsTooltip: 'Consensus committees are selected through cryptographic sortition; this is not directly comparable to a fixed validator-set count.',
        stakingPct: 'Dynamic',
        annualIssuance: 'Scheduled distribution',
        annualIssuanceTooltip: 'ALGO has a 10B cap. Circulating supply and supplementary staking incentives are still changing, so “0% issuance” is not a sufficient description.',
        selfAmendments: 'Foundation-coordinated releases',
        selfAmendmentsNote: 'not a Tezos-style protocol self-amendment count',
        selfAmendmentsTooltip: 'xGov (expert governance) gives community input, but upgrades are Foundation-coordinated.',
        hardForks: 'Foundation-coordinated upgrades',
        energyPerTx: 'Low-energy PPoS',
        energyPerTxNote: 'see methodology source',
        avgTxFee: 'Protocol minimum',
    },
    tezosStatic: {
        // Fallback values when live data isn't available yet
        stakingPct: 'Unavailable',
        stakingPctNote: 'loaded in-browser from current network statistics when available',
        annualIssuance: 'Unavailable',
        annualIssuanceNote: 'loaded in-browser from protocol issuance plus active LB when available',
        validators: 'See /health',
        validatorsNote: 'live address-level >1/3 and >2/3 thresholds',
        validatorsTooltip: 'Network Health calculates both current-cycle thresholds from the official Octez baking-power distribution. Cross-chain rows may use different thresholds or entity grouping and are not ranked.',
        slashing: 'Adaptive',
        slashingNote: 'Scales with offense severity',
        blockTime: '~6s',
        finality: '~12s',
        finalityNote: '2 blocks',
        hardForks: 'Protocol self-amendment',
        hardForksNote: 'no persistent upgrade-driven community split in tracked history',
        energyPerTx: 'Low-energy proof of stake',
        energyPerTxNote: 'methodology and transaction mix vary',
        avgTxFee: 'Variable',
        avgTxFeeNote: 'depends on operation type and network conditions',
    }
};
