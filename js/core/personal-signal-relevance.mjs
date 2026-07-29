function finiteNumber(value) {
    if (value == null || value === '') return null;
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
}

function compactNumber(value, maximumFractionDigits = 1) {
    const number = finiteNumber(value);
    if (number == null) return '';
    return number.toLocaleString('en-US', {
        notation: Math.abs(number) >= 10_000 ? 'compact' : 'standard',
        maximumFractionDigits
    });
}

function formatTez(value, maximumFractionDigits = 1) {
    const formatted = compactNumber(value, maximumFractionDigits);
    return formatted ? `${formatted} XTZ` : '';
}

function formatUsd(value) {
    const number = finiteNumber(value);
    if (number == null) return '';
    return number.toLocaleString('en-US', {
        style: 'currency',
        currency: 'USD',
        notation: Math.abs(number) >= 10_000 ? 'compact' : 'standard',
        maximumFractionDigits: Math.abs(number) >= 10_000 ? 1 : 0
    });
}

function whaleMultiple(amountXtz, balanceXtz) {
    const amount = finiteNumber(amountXtz);
    const balance = finiteNumber(balanceXtz);
    if (amount == null || amount <= 0 || balance == null || balance <= 0) return '';
    const multiple = amount / balance;
    const maximumFractionDigits = multiple >= 10 ? 0 : multiple >= 1 ? 1 : 2;
    return compactNumber(multiple, maximumFractionDigits);
}

export function describePersonalSignalRelevance(signal, {
    data = {},
    portfolio = {},
    stats = {},
    xtzPrice = null,
    linkedEtherlinkAccounts = 0
} = {}) {
    const category = String(signal?.category || '');
    const story = data?.story || {};
    const portfolioTotal = finiteNumber(portfolio?.total);
    const portfolioStaked = finiteNumber(portfolio?.staked);
    const creatorCount = Math.max(0, finiteNumber(story?.creatorStats?.totalCreated) || 0);

    if (category === 'price' && portfolioTotal > 0) {
        const price = finiteNumber(data?.xtzPrice) ?? finiteNumber(xtzPrice);
        const position = price == null ? '' : formatUsd(portfolioTotal * price);
        return position ? `Your current XTZ position is about ${position} at spot.` : '';
    }

    if (category === 'staking' && portfolioStaked > 0) {
        return `You have ${formatTez(portfolioStaked)} directly staked.`;
    }

    if (category === 'baker' && data?.bakerName) {
        return data?.isBaker === true
            ? 'This is your operator lane.'
            : `Your baker is ${data.bakerName}.`;
    }

    if (category === 'governance') {
        const receipts = Math.max(0, finiteNumber(story?.proposalsInjected) || 0)
            + Math.max(0, finiteNumber(story?.bakerProposalsInjected) || 0);
        return receipts > 0
            ? `${compactNumber(receipts, 0)} accepted proposal receipt${receipts === 1 ? '' : 's'} already sit in your orbit.`
            : '';
    }

    if (category === 'nft' && finiteNumber(story?.nftAssetsCollected) > 0) {
        const count = finiteNumber(story.nftAssetsCollected);
        return `Your collection currently counts ${compactNumber(count, 0)} assets.`;
    }

    if (category === 'domains' && story?.domainAlias) {
        return `${story.domainAlias} is your on-chain identity here.`;
    }

    if (category === 'contracts' && creatorCount > 0) {
        return `You have created ${compactNumber(creatorCount, 0)} assets on Tezos.`;
    }

    if (category === 'volume' && creatorCount > 0) {
        return `Your creator history includes ${compactNumber(creatorCount, 0)} assets on Tezos.`;
    }

    if (category === 'cycle') {
        if (portfolioStaked > 0) {
            return 'Your stake and reward accounting advance on this cycle clock.';
        }
        if (data?.bakerAddr) {
            return 'Your baker rights and reward accounting advance on this cycle clock.';
        }
    }

    if (category === 'whales' && portfolioTotal > 0) {
        const multiple = whaleMultiple(signal?.valueXtz, portfolioTotal);
        return multiple ? `This move is ${multiple}× your current XTZ balance.` : '';
    }

    if (category === 'lb') {
        const apyRate = finiteNumber(data?.apyRate);
        return apyRate == null
            ? ''
            : `Subsidy changes affect the issuance side of your ${compactNumber(apyRate, 2)}% APY context.`;
    }

    if (category === 'etherlink') {
        const count = Math.max(0, Math.trunc(finiteNumber(linkedEtherlinkAccounts) || 0));
        return count > 0
            ? `You have ${compactNumber(count, 0)} explicitly linked Etherlink account${count === 1 ? '' : 's'}.`
            : '';
    }

    if (category === 'security' && data?.bakerAddr) {
        const totalBakers = finiteNumber(stats?.totalBakers);
        return totalBakers == null || totalBakers <= 0
            ? ''
            : `Your baker is one of ${compactNumber(totalBakers, 0)} active bakers.`;
    }

    if (category === 'ecosystem') {
        const days = finiteNumber(story?.daysSinceJoin);
        const era = String(story?.joinedEra || '').trim();
        return days != null && days > 0 && era
            ? `You joined ${compactNumber(days, 0)} days ago, in the ${era} era.`
            : '';
    }

    // tz4 and Maxis stay silent until their per-account switch/passport
    // evidence is already loaded into the My Tezos data contract.
    return '';
}

export function rankSignalsByPersonalRelevance(signals, context = {}, scoreFor = signal => signal?.score) {
    return (Array.isArray(signals) ? signals : [])
        .map((signal, index) => ({
            signal,
            index,
            relevance: describePersonalSignalRelevance(signal, context),
            score: finiteNumber(scoreFor(signal)) || 0
        }))
        .sort((left, right) => {
            const relevanceDiff = Number(Boolean(right.relevance)) - Number(Boolean(left.relevance));
            if (relevanceDiff) return relevanceDiff;
            const scoreDiff = right.score - left.score;
            return Math.abs(scoreDiff) > 0.001 ? scoreDiff : left.index - right.index;
        })
        .map(entry => entry.signal);
}
