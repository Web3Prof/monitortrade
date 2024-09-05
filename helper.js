import { programs } from '@metaplex/js';
const { Metadata } = programs.metadata;
import * as solanaWeb3 from '@solana/web3.js';

import dotenv from 'dotenv';
dotenv.config();

const SLIPPAGE = parseInt(process.env.SLIPPAGE) || 50;
const myWallet = new Wallet(solanaWeb3.Keypair.fromSecretKey(bs58.decode(process.env.PRIVATE_KEY || '')));


async function getTokenMetadata(connection, mint) {
    try {
        const metadataPDA = await Metadata.getPDA(mint);
        const metadata = await Metadata.load(connection, metadataPDA);
        return metadata.data.data;
    } catch (error) {
        console.error(`Error fetching metadata for mint ${mint}: `, error);
        return 'Unknown Token';
    }
}

async function getTokenOwner(connection, account) {
    const accountInfo = await connection.getAccountInfo(new solanaWeb3.PublicKey(account));
    return (accountInfo) ? accountInfo.owner.toBase58() : "";
}

async function swapTokens(connection, inputMint, inputAmount, outputMint, priorityFee) {

    console.log("Swapping from " + inputMint + " to " + outputMint);
    try {
        const response = await axios.get('https://quote-api.jup.ag/v6/quote', {
            params: {
                inputMint: inputMint,
                outputMint: outputMint,
                amount: inputAmount,
                slippageBps: SLIPPAGE
            }
        });
        const quoteResponse = response.data;
        // console.log(quoteResponse);

        // get serialized transactions for the swap
        // Get swap transaction
        const swapResponse = await axios.post('https://quote-api.jup.ag/v6/swap', {
            quoteResponse,
            userPublicKey: myWallet.publicKey.toString(),
            wrapAndUnwrapSol: true,
            dynamicComputeUnitLimit: true,
            prioritizationFee: priorityFee, // prioritization fee in lamports

        }, {
            headers: {
                'Content-Type': 'application/json'
            }
        });

        // Destructure to get the swapTransaction
        const { swapTransaction } = swapResponse.data;
        // console.log(swapTransaction);

        // deserialize the transaction
        const swapTransactionBuf = Buffer.from(swapTransaction, 'base64');
        var transaction = solanaWeb3.VersionedTransaction.deserialize(swapTransactionBuf);
        // sign the transaction
        transaction.sign([myWallet.payer]);

        // get the latest block hash
        const latestBlockHash = await connection.getLatestBlockhash();

        // Execute the transaction
        const rawTransaction = transaction.serialize()
        const txid = await connection.sendRawTransaction(rawTransaction, {
            skipPreflight: true,
            maxRetries: 2
        });

        console.log("Transaction signed, processing tx " + txid);

        await connection.confirmTransaction({
            blockhash: latestBlockHash.blockhash,
            lastValidBlockHeight: latestBlockHash.lastValidBlockHeight,
            signature: txid
        });
        console.log(`Transaction Successful. View on Solscan: https://solscan.io/tx/${txid}`);
        console.log();
        return true;
    }
    catch (error) {
        console.log('Error swapping tokens:', error.message);
        return false;
    }
}

export { getTokenMetadata, getTokenOwner, swapTokens };