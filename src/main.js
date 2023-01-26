const { getHttpEndpoint, getHttpV4Endpoint } = require("@orbs-network/ton-access");
const { Address, TonClient, TonClient4} = require("ton");
const BigNumber = require('bignumber.js');
const _ = require('lodash');
require('dotenv').config();

const votingContract = Address.parse("Ef_bG7kFwT4lLusRCfMN_n2mY4X4Gsa-IT9tpcNKproRukpH");


async function getClientV2() {

    // get the decentralized RPC endpoint
    const endpoint = await getHttpEndpoint();

    // initialize ton library
    return new TonClient({ endpoint });
}

async function getClientV4() {

    const endpoint = await getHttpV4Endpoint();

    // initialize ton library
    return new TonClient4({ endpoint });
}

async function getTransactions(client, startPage = {fromLt: "0", hash: ""}) {

    let toLt = null;
    let maxLt = new BigNumber(toLt ?? -1);

    let allTxns = [];
    let paging = startPage

    while (true) {
        console.log("Querying...");
        const txns = await client.getTransactions(votingContract, {
            lt: paging.fromLt,
            to_lt: toLt ?? undefined,
            hash: paging.hash,
            limit: 100,
        });

        console.log(`Got ${txns.length}, lt ${paging.fromLt}`);

        allTxns = [...allTxns, ...txns];

        if (txns.length === 0) break;

        paging.fromLt = txns[txns.length - 1].id.lt;
        paging.hash = txns[txns.length - 1].id.hash;
        txns.forEach((t) => {
            maxLt = BigNumber.max(new BigNumber(t.id.lt), maxLt);
        });
    }

    return { allTxns, paging };
}

function getAllVotes(transactions, proposalInfo) {

    let allVotes = {}

    for (let i = transactions.length - 1; i >= 0 ; i--) {
        let vote =  transactions[i].inMessage.body.text;
        if (!vote) continue;

        if (transactions[i].time < proposalInfo.startDate || transactions[i].time > proposalInfo.endDate) continue;

        vote = vote.toLowerCase();

        if (['y', 'yes'].includes(vote)) {
            allVotes[transactions[i].inMessage.source.toFriendly()] = 'Yes'
        } else if (['n', 'no'].includes(vote)) {
            allVotes[transactions[i].inMessage.source.toFriendly()] = 'No'
        } else if (['a', 'abstain'].includes(vote)) {
            allVotes[transactions[i].inMessage.source.toFriendly()] = 'Abstain'
        }
    }

    return allVotes;
}

async function getVotingPower(clientV4, proposalInfo, transactions, votingPower={}) {

    let voters = Object.keys(getAllVotes(transactions, proposalInfo));

    let newVoters = [...new Set([...voters, ...Object.keys(votingPower)])];

    if (!newVoters) return votingPower;

    for (const voter of newVoters) {
        votingPower[voter] = (await clientV4.getAccountLite(proposalInfo.snapshot, Address.parse(voter))).account.balance.coins;
    }

    return votingPower;
}

function calcProposalResult(votes, votingPower) {

    let sumVotes = {yes: new BigNumber(0), no: new BigNumber(0), abstain: new BigNumber(0)};

    for (const [voter, vote] of Object.entries(votes)) {
        if (!(voter in votingPower)) throw new Error(`voter ${voter} not found in votingPower`);

        if (vote === 'Yes') {
            sumVotes.yes = (new BigNumber(votingPower[voter])).plus(sumVotes.yes)
        } else if (vote === 'No') {
            sumVotes.no = (new BigNumber(votingPower[voter])).plus(sumVotes.no)
        } else if (vote === 'Abstain') {
            sumVotes.abstain = (new BigNumber(votingPower[voter])).plus(sumVotes.abstain)
        }
    }

    const totalWeights = sumVotes.yes.plus(sumVotes.no).plus(sumVotes.abstain);
    const yesPct = sumVotes.yes.div(totalWeights).decimalPlaces(2).multipliedBy(100).toNumber();
    const noPct = sumVotes.no.div(totalWeights).decimalPlaces(2).multipliedBy(100).toNumber();
    const abstainPct = sumVotes.abstain.div(totalWeights).decimalPlaces(2).multipliedBy(100).toNumber();

    return {yes: yesPct, no: noPct, abstain: abstainPct, totalWeight: totalWeights.toString()};
}

async function getSnapshotBlock(client) {
    const res = await client.callGetMethod(votingContract, 'proposal_snapshot_block');
    return Number(res.stack[0][1]);
}

async function getStartDate(client) {
    const res = await client.callGetMethod(votingContract, 'proposal_start_time');
    return Number(res.stack[0][1]);
}

async function getEndDate(client) {
    const res = await client.callGetMethod(votingContract, 'proposal_end_time');
    return Number(res.stack[0][1]);
}

function getCurrentResults(transactions, votingPower, proposalInfo) {
    let votes = getAllVotes(transactions, proposalInfo);
    return calcProposalResult(votes, votingPower);
}

async function getProposalInfo(client) {

    return {
        startDate: await getStartDate(client),
        endDate: await getEndDate(client),
        snapshot: await getSnapshotBlock(client)
    };
}

async function test() {

    const client = await getClientV2()
    const clientV4 = await getClientV4()
    // const clientV4 = new TonClient4({endpoint: process.env.TON_ENDPOINT_V4 || "https://mainnet-v4.tonhubapi.com"});

    let tx = await getTransactions(client);
    console.log(tx)

    const proposalInfo = await getProposalInfo(client)
    console.log(proposalInfo);

    let allVotes = getAllVotes(tx.allTxns, proposalInfo);
    console.log(allVotes);

    let votingPower = await getVotingPower(clientV4, proposalInfo, tx.allTxns);
    console.log(votingPower)

    let currResults = getCurrentResults(tx.allTxns, votingPower, proposalInfo);
    console.log(currResults)

}

test().then(() => {console.log('all done')});