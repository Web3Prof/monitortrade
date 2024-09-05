import * as solanaWeb3 from '@solana/web3.js';
import { Wallet } from '@project-serum/anchor';
import cron from 'node-cron';
import bs58 from 'bs58';

import { getTokenMetadata, getTokenOwner, swapTokens } from './helper.js';
import dotenv from 'dotenv';
dotenv.config();

const walletToMonitor = new solanaWeb3.PublicKey('6qSHJNmQm1fEW9HdEojxJz35GDs2TGYynh5NNVG8h3hN');
const WRAPPED_SOL_MINT = 'So11111111111111111111111111111111111111112';
const RAYDIUM_LP_OWNERS = ['CAMMCzo5YL8w4VFF8KVHrK22GGUsp5VTaW7grrKgrWqK', '5Q544fKrFoe6tsEbD7S8EmxGTJYAKtTVhAW5Q5pge4j1'];

const connection = new solanaWeb3.Connection(process.env.RPC_URL, { commitment: 'confirmed', confirmTransactionInitialTimeout: 60000 });

const myWallet = new Wallet(solanaWeb3.Keypair.fromSecretKey(bs58.decode(process.env.PRIVATE_KEY)));
const SOL_BUY_AMT = parseFloat(process.env.SOL_BUY_AMT) * solanaWeb3.LAMPORTS_PER_SOL || 0;

async function monitorWallet() {
    try {

        let txnList = await connection.getSignaturesForAddress(walletToMonitor);
        // Example if you need to filter the transactions by block time or any other condition
        // txnList = txnList.filter(tx => tx.blockTime > "minimumBlockTime" && !tx.err);

        if (txnList.length > 0) {
            let sigList = txnList.map(txn => txn.signature);

            let txnDetails = await connection.getParsedTransactions(sigList, { maxSupportedTransactionVersion: 0 });
            console.log("Transaction fetched!");

            for (let i = 0; i < txnDetails.length; i++) {
                const txn = txnList[i];
                const meta = txnDetails[i].meta

                if (meta.preTokenBalances.length > 0 || meta.postTokenBalances > 0) {
                    const date = new Date(txn.blockTime * 1000);
                    const formattedDate = new Intl.DateTimeFormat('en-US', {
                        day: '2-digit',
                        month: 'short',
                        year: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit',
                        second: '2-digit',
                        hour12: false,
                    }).format(date);

                    console.log(`Txn #${i + 1} by ${walletToMonitor.PublicKey}`);
                    console.log("Date: " + formattedDate);

                    const accountKeys = txnDetails[i].transaction.message.accountKeys;
                    let lpCount = 0;
                    let tokenName, tokenPubkey;
                    let tokenChanged = 0, solChanged = 0;
                    let isBuy = false;

                    for (let j = 0; j < accountKeys.length; j++) {
                        const accountKey = accountKeys[j].pubkey;
                        let preAmount = 0, postAmount = 0;

                        if (accountKey !== solanaWeb3.SystemProgram.programId) {
                            const preBalance = meta.preTokenBalances.find(a => a.accountIndex === j);
                            const postBalance = meta.postTokenBalances.find(a => a.accountIndex === j);

                            if (preBalance || postBalance) {
                                const balance = postBalance ? postBalance : preBalance;
                                const owner = balance.owner;
                                const actualOwner = await getTokenOwner(connection, owner);
                                const tokenMetadata = await getTokenMetadata(connection, new solanaWeb3.PublicKey(balance.mint));

                                const isLP = RAYDIUM_LP_OWNERS.includes(actualOwner) || RAYDIUM_LP_OWNERS.includes(owner);
                                if (isLP) {
                                    lpCount++;
                                    if (preBalance) {
                                        preAmount = parseFloat(preBalance.uiTokenAmount.uiAmountString).toFixed(5);
                                        // console.log(`PRE: ${preAmount} ${tokenMetadata.name}`);
                                    }

                                    if (postBalance) {
                                        postAmount = parseFloat(postBalance.uiTokenAmount.uiAmountString).toFixed(5);
                                        // console.log(`POST: ${postAmount} ${tokenMetadata.name}`);
                                    }

                                    if (balance.mint == WRAPPED_SOL_MINT) {
                                        solChanged = parseFloat(postAmount) - parseFloat(preAmount);
                                        isBuy = solChanged > 0 ? true : false;
                                    } else {
                                        tokenChanged = parseFloat(postAmount) - parseFloat(preAmount);
                                        tokenName = tokenMetadata.name;
                                        tokenPubkey = new solanaWeb3.PublicKey(balance.mint);
                                        isBuy = tokenChanged > 0 ? false : true;
                                    }
                                }
                            }
                        }
                    }

                    if (lpCount > 0) {
                        let action = isBuy ? "BUY" : "SELL";
                        console.log(`${action} ${Math.abs(tokenChanged)} ${tokenName} FOR ${Math.abs(solChanged)} SOL`);
                        const myBalance = await connection.getBalance(myWallet.publicKey);
                        const tokenBalance = await connection.getTokenAccountsByOwner(tokenPubkey)(myWallet.publicKey, { mint: (tokenPubkey) }); // get token account of the token to be swapped
                        if (isBuy) {
                            if (myBalance > SOL_BUY_AMT)
                                swapTokens(connection, WRAPPED_SOL_MINT, SOL_BUY_AMT, tokenPubkey, "priority_fee");
                        }
                        else if (!isBuy) {
                            if (tokenBalance > 0)
                                swapTokens(connection, tokenPubkey, tokenBalance, WRAPPED_SOL_MINT, "priority_fee");
                        }

                    }


                    console.log(("=").repeat(50));
                }
            }
        }

    }
    catch (err) {
        console.log("Error: ", err.message);
    }
}

async function start() {

    try {
        await cron.schedule("*/10 * * * * *", async () => {
            await monitorWallet();
        })
    }
    catch (err) {
        console.log("Error: ", err.message);
    }
}

monitorWallet();
// start();