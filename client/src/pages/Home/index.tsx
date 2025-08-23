import { ChatWindow } from '../../components/chatWindow';
import DirectMessages from '../../components/directMessages';
import styles from './style.module.css';

// icons
import dotsVerticalWhite from '../../assets/icons/dots-vertical-white.svg';
import { RoomList } from '../../components/RoomList';
import { useChat } from '../../shared/chatContext';
import { useClient } from '../../shared/authContext';


export function Home(){
	const { currentRoom, currentClient } = useChat();
	const { username } = useClient();
	const capitalize = (str: string) => str.charAt(0).toUpperCase() + str.slice(1);
	const myUsername = username ? capitalize(username) : 'Guest'

	return (
		<div className={`${styles.home} flex row`}>

			<section className={styles.sidebar}>
				<div className={`${styles.profile} flex`}>
					<img src={`https://avatar.iran.liara.run/public?username=${myUsername}`} alt="pfp" />
					<div className={`${styles.name} center-flex column`}>
						<h2>{myUsername}</h2>
						<p>My Account</p>
					</div>
					<img className={styles.dots} src={dotsVerticalWhite} alt="settings" />
				</div>

				<RoomList />
				<DirectMessages />
			</section>

			<main>
				{(currentRoom || currentClient) && (
					<div class={`${styles.header} center-flex`}>
						<img src={currentRoom ? `https://placehold.co/50x50/8775E9/FFF?text=%23`
							: `https://avatar.iran.liara.run/public?username=${currentClient!.client_id}`} alt="pfp" />
						<div className={`${styles.person} flex column`}>
							<h2>{currentRoom ? capitalize(currentRoom.name) : currentClient!.client_id}</h2>
							<p class="status">{currentRoom
								? `${currentRoom.clients} clients - ${currentRoom.messages} messages - ${new Date(
									currentRoom.last_activity
								).toLocaleString("en-US", {
									year: "numeric",
									month: "short",
									day: "numeric",
									hour: "numeric",
									minute: "2-digit",
									hour12: true,
								})}`
								: `Last seen ${new Date(
									currentClient!.last_seen
								).toLocaleString("en-US", {
									year: "numeric",
									month: "short",
									day: "numeric",
									hour: "numeric",
									minute: "2-digit",
									hour12: true,
								})}`}</p>
						</div>
					</div>
				)}

				<ChatWindow />
			</main>

		</div>
	);
}