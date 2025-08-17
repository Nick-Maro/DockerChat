import { ChatWindow } from '../../components/chatWindow';
import styles from './style.module.css';

// icons
import dotsVerticalWhite from '../../assets/icons/dots-vertical-white.svg';
import { RoomList } from '../../components/RoomList';
import { useChat } from '../../shared/chatContext';


export function Home(){
	const { currentRoom } = useChat();

	const capitalize = (str: string) => str.charAt(0).toUpperCase() + str.slice(1);

	return (
		<div className={`${styles.home} flex row`}>

			<section className={styles.sidebar}>
				<div className={`${styles.profile} flex`}>
					<img src="https://avatar.iran.liara.run/public/girl?username=Jolene" alt="pfp" />
					<div className={`${styles.name} center-flex column`}>
						<h2>Jolene Shaw</h2>
						<p>My Account</p>
					</div>
					<img className={styles.dots} src={dotsVerticalWhite} alt="settings" />
				</div>

				<RoomList />

				<div className={styles.dm}>
					<h2>Direct Messages</h2>
					<ul className="flex column">
						<li className={styles.active}>
							<img src="https://avatar.iran.liara.run/public/girl?username=Addisyn" alt="pfp" />
							<div className={styles.info}>
								<div className={`${styles.name} center-flex row`}>
									<h3>Addisyn Lawson</h3>
									<p>08:23 AM</p>
								</div>
								<p class="last-msg">Typing...</p>
							</div>
						</li>
						<li>
							<img src="https://avatar.iran.liara.run/public/boy?username=River" alt="pfp" />
							<div className={styles.info}>
								<div className={`${styles.name} center-flex row`}>
									<h3>River Pitts</h3>
									<p>12:49 PM</p>
								</div>
								<p class="last-msg">Send now lol 😂</p>
							</div>
						</li>
						<li>
							<img src="https://avatar.iran.liara.run/public/girl?username=Maeve" alt="pfp" />
							<div className={styles.info}>
								<div className={`${styles.name} center-flex row`}>
									<h3>Maeve Fry</h3>
									<p>05:11 PM</p>
								</div>
								<p class="last-msg">Sure, I'll do it right...</p>
							</div>
						</li>
					</ul>
				</div>
			</section>

			<main>
				{currentRoom && (
					<div class={`${styles.header} center-flex`}>
						<img src={`https://placehold.co/50x50/8775E9/FFF?text=%23`} alt="pfp" />
						<div className={`${styles.person} flex column`}>
							<h2>{capitalize(currentRoom.name)}</h2>
							<p class="status">{currentRoom.clients} clients - {currentRoom.messages} messages - {new Date(currentRoom.last_activity).toLocaleString("en-US", {
								year: "numeric",
								month: "short",
								day: "numeric",
								hour: "numeric",
								minute: "2-digit",
								hour12: true
							})}</p>
						</div>
					</div>
				)}

				<ChatWindow />
			</main>

		</div>
	);
}