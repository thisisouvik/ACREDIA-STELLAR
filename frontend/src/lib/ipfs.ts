/**
 * IPFS Storage using free NFT.Storage / IPFS API
 */

/**
 * Upload file to IPFS using NFT.Storage free API
 */
export async function uploadToIPFS(file: File): Promise<string> {
    try {
        const formData = new FormData();
        formData.append('file', file);

        const response = await fetch('https://api.nft.storage/upload', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${process.env.NEXT_PUBLIC_NFT_STORAGE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJkaWQ6ZXRocjoweDhEODc4NDMzODlCNjE0NjhFNjgxRjI2ODBCNjY4RTQ2RTQwRTQwNkIiLCJpc3MiOiJuZnQtc3RvcmFnZSIsImlhdCI6MTYzMjE1NTQzMjQ4NCwibmFtZSI6ImRlbW8ifQ.fEcSw_MQjKiUDGhKYqweHqgfY3VfFCXZRQcJoFtYA5U'}`,
            },
            body: formData,
        });

        if (!response.ok) {
            throw new Error(`IPFS upload failed: ${response.statusText}`);
        }

        const result = await response.json();
        console.log('✅ Uploaded to IPFS:', result.value.cid);
        return result.value.cid;
    } catch (error) {
        console.error('Error uploading to IPFS:', error);
        throw new Error('Failed to upload to IPFS');
    }
}

export async function uploadJSONToIPFS(data: any): Promise<string> {
    try {
        const jsonString = JSON.stringify(data);
        const blob = new Blob([jsonString], { type: 'application/json' });
        const file = new File([blob], 'metadata.json', { type: 'application/json' });
        return await uploadToIPFS(file);
    } catch (error) {
        console.error('Error uploading JSON to IPFS:', error);
        throw new Error('Failed to upload JSON to IPFS');
    }
}

export function getIPFSUrl(cidOrUri: string): string {
    if (!cidOrUri || cidOrUri.trim() === '') {
        return '#';
    }

    let fullPath = cidOrUri.replace('ipfs://', '');
    const parts = fullPath.split('/');
    const cid = parts[0];
    const path = parts.length > 1 ? '/' + parts.slice(1).join('/') : '';

    if (!cid || cid === 'undefined' || cid === 'null') {
        return '#';
    }

    // Use ipfs.io public gateway with path format
    return `https://ipfs.io/ipfs/${cid}${path}`;
}

export async function fetchFromIPFS(cid: string): Promise<any> {
    try {
        const url = getIPFSUrl(cid);
        const response = await fetch(url);
        if (!response.ok) {
            throw new Error(`Failed to fetch from IPFS: ${response.statusText}`);
        }
        return await response.json();
    } catch (error) {
        console.error('Error fetching from IPFS:', error);
        throw new Error('Failed to fetch from IPFS');
    }
}
