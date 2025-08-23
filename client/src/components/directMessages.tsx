import { useState } from 'preact/hooks';
import styles from '../css/directMessages.module.css';
import { useChat } from '../shared/chatContext';
import { formatDateTime } from '../shared/utils';
import { Client } from '../types';


export default function DirectMessages(){
    const { clients, currentClient, setCurrentClient, leaveRoom, fetchPrivateMessages } = useChat();

    const selectClient = (client: Client) => {
        setCurrentClient(client);
        fetchPrivateMessages(client.client_id);
        leaveRoom();
    }

    return (
        <div className={styles.dm}>
            <h2>Direct Messages</h2>
            <ul className="flex column">
                {!clients || clients.length === 0 ? ( 
                    <p>No users yet.</p>
                ) : clients.map((client, index) => { return (
                    <li className={`${styles.client} ${currentClient === client ? styles.active : ''}`}
                        key={client.client_id} onClick={() => selectClient(client)}>
                        {client.online ? <span className={styles.onlineBadge}></span> : undefined }
                        <img src={`https://avatar.iran.liara.run/public?username=${client.client_id}`} alt="pfp" />
                        <div className={styles.info}>
                            <div className={`${styles.name} center-flex row`}>
                                <h3>{client.client_id}</h3>
                                <p>{formatDateTime(client.last_seen)}</p>
                            </div>
                            {/* <p class="last-msg">Typing...</p> */}
                        </div>
                    </li>
                )})}
            </ul>
        </div>
    )
}