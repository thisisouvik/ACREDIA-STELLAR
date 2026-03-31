'use client';

import { useStellarAccount } from '@/contexts/StellarContext';
import { Button } from './button';
import { Wallet } from 'lucide-react';

export function ConnectWallet() {
    const { address, isConnecting, connect, disconnect } = useStellarAccount();

    if (address) {
        return (
            <Button 
                onClick={disconnect} 
                variant="outline" 
                className="border-teal-600 text-teal-600 hover:bg-red-50 hover:text-red-700 hover:border-red-600 transition-colors"
                title="Disconnect Wallet"
            >
                <Wallet className="h-4 w-4 mr-2" />
                {address.slice(0, 5)}...{address.slice(-4)}
            </Button>
        );
    }

    return (
        <Button 
            onClick={connect} 
            disabled={isConnecting} 
            className="bg-linear-to-r from-teal-600 to-cyan-600 text-white font-semibold hover:from-teal-700 hover:to-cyan-700 transition-all shadow-md"
        >
            <Wallet className="h-4 w-4 mr-2" />
            {isConnecting ? 'Connecting...' : 'Connect Wallet'}
        </Button>
    );
}
