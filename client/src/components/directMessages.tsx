import { useState } from 'preact/hooks';
import styles from '../css/directMessages.module.css';
import { useChat } from '../shared/chatContext';
import { useUnread } from '../shared/unreadMessagesContext';
import { formatDateTime } from '../shared/utils';
import { Client } from '../types';

export default function DirectMessages() {
    const { clients, currentClient, setCurrentClient, leaveRoom, fetchPrivateMessages } = useChat();
    const { getUnreadCount, clearUnread } = useUnread();

    const selectClient = (client: Client) => {
       
        clearUnread(`client_${client.client_id}`);
        if (window.setCurrentChat) {
            window.setCurrentChat(`client_${client.client_id}`);
        }
        
        setCurrentClient(client);
        fetchPrivateMessages(client.client_id);
        leaveRoom();
    }
    const UnreadBadge = ({ clientId }: { clientId: string }) => {
        const count = getUnreadCount(`client_${clientId}`);
        if (count === 0) return null;
        
        return (
            <span className={styles.unreadBadge}>
                {count > 99 ? '99+' : count}
            </span>
        );
    };

    return (
        <div className={styles.dm}>
            <h2>Direct Messages</h2>
            <ul className="flex column">
                {!clients || clients.length === 0 ? (
                    <p>No users yet.</p>
                ) : clients.slice().sort((a, b) => {
                    
                    const unreadA = getUnreadCount(`client_${a.client_id}`);
                    const unreadB = getUnreadCount(`client_${b.client_id}`);
                    
                    if (unreadA !== unreadB) {
                        return unreadB - unreadA; 
                    }
                    
                    return +new Date(b.last_seen) - +new Date(a.last_seen);
                }).map((client, index) => {
                    const hasUnread = getUnreadCount(`client_${client.client_id}`) > 0;
                    
                    return (
                        <li className={`${styles.client} ${currentClient === client ? styles.active : ''} ${hasUnread ? styles.hasUnread : ''}`}
                            key={client.client_id} onClick={() => selectClient(client)}>
                            {client.online ? <span className={styles.onlineBadge}></span> : undefined}
                            <img src={`https://avatar.iran.liara.run/public?username=${client.client_id}`} alt="pfp" />
                            <div className={styles.info}>
                                <div className={styles.nameContainer}>
                                    <div className={styles.nameWithBadge}>
                                        <h3>{client.client_id}</h3>
                                        <UnreadBadge clientId={client.client_id} />
                                    </div>
                                    <div className={styles.rightInfo}>
                                        <p>{formatDateTime(client.last_seen)}</p>
                                    </div>
                                </div>
                                {/* <p class="last-msg">Typing...</p> */}
                            </div>
                        </li>
                    );
                })}
            </ul>
        </div>
    )
}