import { activeNetwork, sorobanServer, getContractAddress } from "./stellar";
import { signTransaction } from "@stellar/freighter-api";
import { Address, nativeToScVal, scValToNative, FeeBumpTransaction, TransactionBuilder, Networks, TimeoutInfinite, StrKey, Contract, Transaction, xdr } from "@stellar/stellar-sdk";

export interface CredentialMetadata {
    studentAddress: string;
    credentialHash: string;
    ipfsHash: string;
    issuerAddress: string;
    issuedAt: number;
}

/**
 * Core smart contract invocation helper for Soroban
 * Handles transaction building, simulation, freighter signing, and submission.
 */
async function invokeContractMethod(
    contractId: string,
    method: string,
    args: any[],
    signerAddress: string
): Promise<string> {
    try {
        const contract = new Contract(contractId);
        const sourceAccountResponse = await sorobanServer.getAccount(signerAddress);

        // Prepare the basic transaction
        const txBuilder = new TransactionBuilder(sourceAccountResponse, {
            fee: "100", // Will be simulated
            networkPassphrase: activeNetwork.networkPassphrase,
        })
        .addOperation(contract.call(method, ...args))
        .setTimeout(TimeoutInfinite); // Soroban needs no timeout or a sufficient one

        const transaction = txBuilder.build();

        // Prepare transaction (simulates and adds resources)
        console.log(`Preparing ${method}...`);
        const preparedTransaction = await sorobanServer.prepareTransaction(transaction as any);

        // Sign with Freighter wallet
        const signedXdr = await signTransaction(preparedTransaction.toXDR(), {
            networkPassphrase: activeNetwork.networkPassphrase,
            network: activeNetwork.networkName
        } as any);

        // Parse and submit the signed transaction to RPC server
        const signedTx = TransactionBuilder.fromXDR(signedXdr as any, activeNetwork.networkPassphrase);
        const sendResponse = await sorobanServer.sendTransaction(signedTx as any);


        if (sendResponse.status === "ERROR") {
            throw new Error(`Submission failed: ${sendResponse.errorResult?.toXDR("base64") || "Unknown error"}`);
        }

        return sendResponse.hash;
    } catch (e) {
        console.error("Contract invocation error:", e);
        throw e;
    }
}

/**
 * Get the contract owner from Soroban
 */
export async function getContractOwner(): Promise<string> {
    const contractId = getContractAddress("CREDENTIAL_NFT");
    const contract = new Contract(contractId);
    
    // Unauthenticated read via simulation using dummy account ID (the contract itself)
    const txBuilder = new TransactionBuilder(await sorobanServer.getAccount(contractId), {
        fee: "100",
        networkPassphrase: activeNetwork.networkPassphrase,
    })
    .addOperation(contract.call("get_owner"))
    .setTimeout(TimeoutInfinite);

    const sim = await sorobanServer.simulateTransaction(txBuilder.build());
    if ("error" in sim) return "";
    
    // Parse result: get_owner returns an Address
    const resultXdr = (sim as any).result?.retval;
    if (!resultXdr) return "";

    try {
        const scval = xdr.ScVal.fromXDR(resultXdr, "base64");
        return scValToNative(scval);
    } catch {
        return "";
    }
}

/**
 * Authorize an issuer (admin only)
 */
export async function authorizeIssuer(adminAddress: string, issuerAddress: string): Promise<string> {
    const contractId = getContractAddress("CREDENTIAL_NFT");
    const args = [new Address(issuerAddress).toScVal()];
    return invokeContractMethod(contractId, "authorize_issuer", args, adminAddress);
}

/**
 * Check if issuer is authorized
 */
export async function isAuthorizedIssuer(issuerAddress: string): Promise<boolean> {
    const contractId = getContractAddress("CREDENTIAL_NFT");
    const contract = new Contract(contractId);
    
    // Unauthenticated read via simulation
    // We create a dummy source account since simulation of reads still technically needs one for the container
    const txBuilder = new TransactionBuilder(await sorobanServer.getAccount(contractId), {
        fee: "100",
        networkPassphrase: activeNetwork.networkPassphrase,
    })
    .addOperation(contract.call("is_authorized_issuer", new Address(issuerAddress).toScVal()))
    .setTimeout(TimeoutInfinite);

    const sim = await sorobanServer.simulateTransaction(txBuilder.build());
    if ("error" in sim) return false;
    
    // Parse result XDR (simplified for true/false)
    const resultXdr = (sim as any).result?.retval;
    return resultXdr ? true : false; 
}

/**
 * Issue a credential on Stellar Network
 */
export async function issueCredentialOnStellar(
    studentAddress: string,
    credentialHash: string,
    ipfsUri: string,
    issuerAddress: string
): Promise<{ tokenId: string; transactionHash: string }> {
    try {
        console.log('Issuing credential on Stellar Network...');
        const contractId = getContractAddress("CREDENTIAL_NFT");
        
        const args = [
            new Address(studentAddress).toScVal(),
            new Address(issuerAddress).toScVal(),
            nativeToScVal(credentialHash, { type: "string" }),
            nativeToScVal(ipfsUri, { type: "string" }),
        ];

        const txHash = await invokeContractMethod(contractId, "issue_credential", args, issuerAddress);
        
        console.log('✅ Credential issued on Stellar Network');
        
        // We do not have block explorers resolving transaction token IDs immediately without indexers,
        // so we return the txHash. For testing we mock tokenId.
        return {
            tokenId: "pending",
            transactionHash: txHash,
        };
    } catch (error) {
        console.error('Error issuing credential on Stellar:', error);
        throw new Error('Failed to issue credential on Stellar Network');
    }
}

/**
 * Revoke a credential on Stellar Network
 */
export async function revokeCredentialOnStellar(
    tokenId: string,
    issuerAddress: string
): Promise<string> {
    try {
        console.log('Revoking credential on Stellar Network...');
        const contractId = getContractAddress("CREDENTIAL_NFT");
        
        // Convert token_id string to u64 scval
        const args = [
            nativeToScVal(Number(tokenId), { type: "u64" }),
            new Address(issuerAddress).toScVal()
        ];

        const txHash = await invokeContractMethod(contractId, "revoke_credential", args, issuerAddress);
        
        console.log('✅ Credential revoked on Stellar Network');
        return txHash;
    } catch (error) {
        console.error('Error revoking credential on Stellar:', error);
        throw new Error('Failed to revoke credential on Stellar Network');
    }
}

/**
 * Generate credential hash from metadata
 * Uses Browser Crypto API SHA-256
 */
export async function generateCredentialHash(metadata: any): Promise<string> {
    const dataString = JSON.stringify(metadata);
    const msgUint8 = new TextEncoder().encode(dataString);
    const hashBuffer = await crypto.subtle.digest('SHA-256', msgUint8);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Verify if a Stellar address is valid
 * Stellar ed25519 public keys start with G
 */
export function isValidStellarAddress(address: string): boolean {
    return StrKey.isValidEd25519PublicKey(address);
}

/**
 * Common export for app compatibility
 */
export function isValidAddress(address: string): boolean {
    return isValidStellarAddress(address);
}

export function formatStellarAddress(address: string, length: number = 8): string {
    if (!address || address.length < 2 * length) return address;
    return `${address.substring(0, length)}...${address.substring(address.length - length)}`;
}
