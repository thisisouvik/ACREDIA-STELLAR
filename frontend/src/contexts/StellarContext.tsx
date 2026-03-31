'use client';

import React, { createContext, useContext, useEffect, useState } from 'react';
import {
    isConnected,
    requestAccess,
    setAllowed,
} from '@stellar/freighter-api';
import { toast } from 'sonner';

interface StellarContextType {
    address: string | null;
    isConnecting: boolean;
    connect: () => Promise<void>;
    disconnect: () => void;
}

const StellarContext = createContext<StellarContextType>({
    address: null,
    isConnecting: false,
    connect: async () => {},
    disconnect: () => {},
});

export const StellarProvider = ({ children }: { children: React.ReactNode }) => {
    const [address, setAddress] = useState<string | null>(null);
    const [isConnecting, setIsConnecting] = useState(false);

    useEffect(() => {
        const checkConnection = async () => {
            try {
                if (await isConnected()) {
                    const access = await requestAccess();
                    if (access && access.address) {
                        setAddress(access.address);
                    }
                }
            } catch (e) {
                // Ignore silently, wallet just not unlocked/connected
            }
        };
        checkConnection();
    }, []);

    const connect = async () => {
        setIsConnecting(true);
        try {
            const connected = await isConnected();
            if (!connected) {
                toast.error("Freighter wallet not detected. Please install the browser extension!");
                setIsConnecting(false);
                return;
            }
            
            await setAllowed();
            const access = await requestAccess();
            if (access && access.address) {
                setAddress(access.address);
                toast.success("Wallet connected!");
            }
        } catch (error: any) {
            console.error("Failed to connect Freighter:", error);
            toast.error(error.message || "Connection refused");
        } finally {
            setIsConnecting(false);
        }
    };

    const disconnect = () => {
        setAddress(null);
        toast.info("Wallet disconnected from app level.");
    };

    return (
        <StellarContext.Provider value={{ address, isConnecting, connect, disconnect }}>
            {children}
        </StellarContext.Provider>
    );
};

export const useStellarAccount = () => useContext(StellarContext);
