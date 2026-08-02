#!/usr/bin/env node

import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  governanceCareerContentHash,
  validateGovernanceCareerArtifact
} from './lib/maxis-governance-career.mjs';
import { isImplicitAddress } from './lib/maxis-evaluator-v2-primitives.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CAREERS_PATH = 'data/maxis-careers.json';
const GOVERNANCE_VOTES_PATH = 'data/governance-votes.json';
const OUTPUT_PATH = 'data/baker-governance-signals.json';
const CAREERS_FILE = path.join(ROOT, CAREERS_PATH);
const GOVERNANCE_VOTES_FILE = path.join(ROOT, GOVERNANCE_VOTES_PATH);
const OUTPUT_FILE = path.join(ROOT, OUTPUT_PATH);
const SCHEMA = 1;
const KIND = 'baker-governance-signals';
const MAX_OUTPUT_BYTES = 96 * 1024;

function hasFlag(name) {
  return process.argv.includes(name);
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function compareCodePoint(left, right) {
  return String(left) < String(right) ? -1 : String(left) > String(right) ? 1 : 0;
}

function nonNegativeInteger(value) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
}

function validateGovernanceVotes(artifact) {
  assert(Number.isFinite(Date.parse(artifact?.generatedAt || '')), 'Governance votes generatedAt must be an ISO timestamp');
  assert(Array.isArray(artifact?.epochs), 'Governance votes epochs must be an array');
  assert(Number(artifact.epochCount) === artifact.epochs.length, 'Governance votes epochCount must match epochs length');
  const seenIndexes = new Set();
  const seenAcceptedHashes = new Set();
  let previousIndex = -1;
  for (const [position, epoch] of artifact.epochs.entries()) {
    const index = nonNegativeInteger(epoch?.index);
    assert(index !== null && !seenIndexes.has(index), `Governance votes epoch ${position} has an invalid or duplicate index`);
    assert(index > previousIndex, `Governance votes epoch ${index} is not strictly ordered`);
    seenIndexes.add(index);
    previousIndex = index;
    assert(Array.isArray(epoch?.proposals), `Governance votes epoch ${index} proposals must be an array`);
    for (const proposal of epoch.proposals) {
      if (proposal?.status !== 'accepted') continue;
      const hash = String(proposal?.hash || '').trim();
      const address = String(proposal?.initiator?.address || '').trim();
      assert(hash && !seenAcceptedHashes.has(hash), `Governance votes repeat accepted proposal ${hash || '(missing hash)'}`);
      assert(isImplicitAddress(address), `Accepted proposal ${hash} has an invalid initiator address`);
      seenAcceptedHashes.add(hash);
    }
  }
}

function sourceGeneratedAt(careers, governanceVotes) {
  const generatedAt = Math.max(
    Date.parse(careers.generatedAt || ''),
    Date.parse(governanceVotes.generatedAt || '')
  );
  assert(Number.isFinite(generatedAt), 'Baker governance signal sources need valid generatedAt timestamps');
  return new Date(generatedAt).toISOString();
}

function acceptedProposalIndex(governanceVotes) {
  const byAddress = new Map();
  for (const epoch of governanceVotes.epochs) {
    for (const proposal of epoch.proposals || []) {
      if (proposal?.status !== 'accepted') continue;
      const hash = String(proposal.hash).trim();
      const address = String(proposal.initiator.address).trim();
      const rows = byAddress.get(address) || [];
      rows.push({
        hash,
        name: String(proposal?.extras?.alias || '').trim() || `${hash.slice(0, 8)}…`,
        epoch: nonNegativeInteger(proposal?.epoch)
      });
      byAddress.set(address, rows);
    }
  }
  return byAddress;
}

export function buildBakerGovernanceSignals({ careers, governanceVotes, careersText, governanceVotesText }) {
  const careerErrors = validateGovernanceCareerArtifact(careers);
  assert(!careerErrors.length, `Invalid Maxis governance careers source: ${careerErrors.join('; ')}`);
  validateGovernanceVotes(governanceVotes);
  const acceptedByAddress = acceptedProposalIndex(governanceVotes);
  const records = {};
  let acceptedProposalCount = 0;

  const activeRecords = Object.values(careers.records || {})
    .filter((record) => record?.activeDelegate === true)
    .sort((left, right) => compareCodePoint(left.address, right.address));
  for (const career of activeRecords) {
    const address = String(career.address || '').trim();
    assert(isImplicitAddress(address), `Active governance career has an invalid address: ${address || '(missing)'}`);
    const acceptedProposals = acceptedByAddress.get(address) || [];
    acceptedProposalCount += acceptedProposals.length;
    records[address] = {
      address,
      lifetimeBallots: nonNegativeInteger(career.lifetimeBallots),
      currentBallotPeriodStreak: nonNegativeInteger(career.currentBallotPeriodStreak),
      longestBallotPeriodStreak: nonNegativeInteger(career.longestBallotPeriodStreak),
      acceptedProposals
    };
  }

  const unsigned = {
    schema: SCHEMA,
    kind: KIND,
    generatedAt: sourceGeneratedAt(careers, governanceVotes),
    coverage: {
      status: 'complete',
      mode: 'source-active-delegate-governance-signal-projection',
      subjectScope: 'The complete active-delegate cohort frozen by the Maxis governance career source receipt.',
      zeroSemantics: 'Zero-valued fields mean zero only for an address present in this frozen source cohort.',
      missingAddressSemantics: 'A missing address is outside the source active-delegate cohort, not proof of no governance history.',
      careerSemantics: 'Applied ballot counts and completed Exploration/Promotion streaks are projected without voting weight or quality scoring.',
      proposalSemantics: 'Accepted signals count distinct TzKT accepted protocol proposal hashes attributed to their initiator address.'
    },
    sources: {
      careers: {
        path: CAREERS_PATH,
        generatedAt: careers.generatedAt,
        coverageStatus: careers.coverage.status,
        recordCount: careers.recordCount,
        activeDelegateCount: activeRecords.length,
        integrityContentHash: careers.integrity.contentHash,
        fileSha256: sha256(careersText)
      },
      governanceVotes: {
        path: GOVERNANCE_VOTES_PATH,
        generatedAt: governanceVotes.generatedAt,
        epochCount: governanceVotes.epochCount,
        acceptedProposalCount: [...acceptedByAddress.values()].reduce((sum, rows) => sum + rows.length, 0),
        fileSha256: sha256(governanceVotesText)
      }
    },
    recordCount: activeRecords.length,
    acceptedProposalCount,
    records
  };
  return {
    ...unsigned,
    integrity: {
      algorithm: 'sha256-stable-json-v1',
      contentHash: governanceCareerContentHash(unsigned)
    }
  };
}

export function validateBakerGovernanceSignals(artifact) {
  const errors = [];
  if (Number(artifact?.schema) !== SCHEMA) errors.push(`schema must be ${SCHEMA}`);
  if (artifact?.kind !== KIND) errors.push(`kind must be ${KIND}`);
  if (!Number.isFinite(Date.parse(artifact?.generatedAt || ''))) errors.push('generatedAt must be an ISO timestamp');
  if (artifact?.coverage?.status !== 'complete'
    || artifact?.coverage?.mode !== 'source-active-delegate-governance-signal-projection'
    || !/Zero-valued fields mean zero only for an address present/i.test(artifact?.coverage?.zeroSemantics || '')
    || !/missing address.*not proof of no governance history/i.test(artifact?.coverage?.missingAddressSemantics || '')) {
    errors.push('coverage must be a complete source-active-delegate projection');
  }
  for (const key of ['careers', 'governanceVotes']) {
    const source = artifact?.sources?.[key];
    if (!Number.isFinite(Date.parse(source?.generatedAt || ''))) errors.push(`${key} source generatedAt is invalid`);
    if (!/^[0-9a-f]{64}$/.test(source?.fileSha256 || '')) errors.push(`${key} source fileSha256 is invalid`);
  }
  if (!/^[0-9a-f]{64}$/.test(artifact?.sources?.careers?.integrityContentHash || '')) {
    errors.push('careers source integrityContentHash is invalid');
  }

  const entries = Object.entries(artifact?.records || {});
  if (Number(artifact?.recordCount) !== entries.length) errors.push('recordCount does not match records');
  let acceptedProposalCount = 0;
  const acceptedHashes = new Set();
  let previousAddress = '';
  for (const [address, record] of entries) {
    if (!isImplicitAddress(address) || record?.address !== address) errors.push(`record ${address} has invalid address identity`);
    if (previousAddress && compareCodePoint(previousAddress, address) >= 0) errors.push('records are not code-point ordered');
    previousAddress = address;
    for (const field of ['lifetimeBallots', 'currentBallotPeriodStreak', 'longestBallotPeriodStreak']) {
      if (nonNegativeInteger(record?.[field]) === null) errors.push(`${address} ${field} is invalid`);
    }
    if (Number(record?.currentBallotPeriodStreak) > Number(record?.longestBallotPeriodStreak)) {
      errors.push(`${address} current ballot streak exceeds its career high`);
    }
    if (!Array.isArray(record?.acceptedProposals)) {
      errors.push(`${address} acceptedProposals must be an array`);
      continue;
    }
    for (const proposal of record.acceptedProposals) {
      acceptedProposalCount += 1;
      if (!String(proposal?.hash || '').trim() || acceptedHashes.has(proposal.hash)) errors.push(`${address} has a missing or repeated accepted proposal hash`);
      acceptedHashes.add(proposal.hash);
      if (!String(proposal?.name || '').trim()) errors.push(`${address} accepted proposal ${proposal?.hash || '(missing)'} lacks a name`);
      if (proposal?.epoch !== null && nonNegativeInteger(proposal.epoch) === null) errors.push(`${address} accepted proposal ${proposal?.hash || '(missing)'} has an invalid epoch`);
    }
  }
  if (Number(artifact?.acceptedProposalCount) !== acceptedProposalCount) errors.push('acceptedProposalCount does not match records');
  const { integrity, ...unsigned } = artifact || {};
  if (integrity?.algorithm !== 'sha256-stable-json-v1'
    || governanceCareerContentHash(unsigned) !== integrity?.contentHash) {
    errors.push('integrity content hash is invalid');
  }
  return errors;
}

async function writeJsonAtomic(file, value) {
  const temporary = `${file}.tmp-${process.pid}`;
  await fs.writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`);
  await fs.rename(temporary, file);
}

async function main() {
  const [careersText, governanceVotesText] = await Promise.all([
    fs.readFile(CAREERS_FILE, 'utf8'),
    fs.readFile(GOVERNANCE_VOTES_FILE, 'utf8')
  ]);
  const artifact = buildBakerGovernanceSignals({
    careers: JSON.parse(careersText),
    governanceVotes: JSON.parse(governanceVotesText),
    careersText,
    governanceVotesText
  });
  const errors = validateBakerGovernanceSignals(artifact);
  assert(!errors.length, `Generated invalid Baker governance signals: ${errors.join('; ')}`);
  const output = `${JSON.stringify(artifact, null, 2)}\n`;
  const bytes = Buffer.byteLength(output);
  assert(bytes <= MAX_OUTPUT_BYTES, `${OUTPUT_PATH} is ${bytes} bytes; maximum is ${MAX_OUTPUT_BYTES}`);

  if (hasFlag('--check')) {
    const existing = await fs.readFile(OUTPUT_FILE, 'utf8');
    assert(existing === output, `${OUTPUT_PATH} is stale; run node scripts/generate-baker-governance-signals.mjs`);
    console.log(`ok - Baker governance signals match reviewed sources (${artifact.recordCount} active delegates, ${bytes} bytes, ${artifact.integrity.contentHash.slice(0, 12)})`);
    return;
  }

  await writeJsonAtomic(OUTPUT_FILE, artifact);
  console.log(`Wrote ${OUTPUT_PATH} (${artifact.recordCount} active delegates, ${bytes} bytes, ${artifact.integrity.contentHash.slice(0, 12)})`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
