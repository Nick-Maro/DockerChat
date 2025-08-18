import styles from '../css/directMessages.module.css';
import { useChat } from '../shared/chatContext';
import { formatDateTime } from '../shared/utils';


export default function DirectMessages(){
    const { clients } = useChat();

    return (
        <div className={styles.dm}>
            <h2>Direct Messages</h2>
            <ul className="flex column">
                {clients.map((client, index) => { return (
                    <li className={styles.active} key={client.client_id}>
                        <img src={`https://avatar.iran.liara.run/public/girl?username=${client.client_id}`} alt="pfp" />
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