import { useRef, useEffect } from 'preact/hooks';
import { generatePublicKey } from './utils';

export function useClientCommands(messages: any[], sendMessage: (msg: any) => void) {
    const requested = useRef<Record<string, boolean | 'forced'>>({});
    const registering = useRef(false);

    const sendCommand = async (command: string, payload: Record<string, any> = {}, force = false) => {
        const clientId = localStorage.getItem('client_id');

        if(!clientId && !registering.current){
            registering.current = true;
            const publicKey = await generatePublicKey();
            sendMessage({ command: 'upload_public_key', client_id: null, public_key: publicKey });
            return;
        }

        if(clientId && (!requested.current[command] || (force && requested.current[command] !== 'forced'))){
            sendMessage({ command, client_id: clientId, ...payload });
            requested.current[command] = force ? 'forced' : true;
        }
    };

    useEffect(() => {
        messages.forEach(msg => {
            if(msg.command === 'upload_public_key' && msg.status === 'registered'){
                localStorage.setItem('client_id', msg.client_id);
                registering.current = false;
            }
        });
    }, [messages]);

    return { sendCommand };
}