import { useEffect, useState } from 'preact/hooks';
import { generateOrLoadKeys, sendCommandHttp } from '../../api/utils';
import ListRooms from '../../components/roomsList';

import styles from './style.module.css';

// icons
import imageBlack from '../../assets/icons/image-black.svg';
import sendWhite from '../../assets/icons/send-white.svg';
import dotsVerticalWhite from '../../assets/icons/dots-vertical-white.svg';
import addIcon from '../../assets/icons/plus-8775e9.svg';


interface Props {
  privateKey: CryptoKey;
  host: string;
  port: number;
}

interface Room {
  id: string;
  name: string;
}


export function Home(){
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

				<div className={`${styles.rooms} flex column`}>
					<h2>Rooms</h2>
					<ul className="center-flex row">
						<li>
							<button className={`${styles.addRoomBtn} center-flex`}>
								<img src={addIcon} alt="add" />
							</button>
						</li>
						<li>
							<img src="https://placehold.co/50x50/8775E9/FFF?text=M" alt="Main Room" />
						</li>
						<li>
							<img src="https://placehold.co/50x50/8775E9/FFF?text=A" alt="Announcements Room" />
						</li>
						<li>
							<img src="https://placehold.co/50x50/8775E9/FFF?text=M" alt="Main Room" />
						</li>
						<li>
							<img src="https://placehold.co/50x50/8775E9/FFF?text=M" alt="Main Room" />
						</li>
						<li>
							<img src="https://placehold.co/50x50/8775E9/FFF?text=M" alt="Main Room" />
						</li>
						<li>
							<img src="https://placehold.co/50x50/8775E9/FFF?text=M" alt="Main Room" />
						</li>
						<li>
							<img src="https://placehold.co/50x50/8775E9/FFF?text=M" alt="Main Room" />
						</li>
					</ul>
				</div>

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
				<div class={`${styles.header} center-flex`}>
					<img src="https://avatar.iran.liara.run/public/girl?username=Addisyn" alt="pfp" />
					<div className={`${styles.person} flex column`}>
						<h2>Addisyn Lawson</h2>
						<p class="status">Typing...</p>
					</div>
				</div>

				{/* <div class="chat flex column">
					<div class="message received">
						Have a great weekend man! <span class="time">12:03</span>
					</div>
					
					<div class="message sent">
						I have to say something about this. Please send Nathans pics before noon 
						<span class="time">12:03</span>
					</div>
					
					<div class="message received">
						I have to say something about this. Please send Nathans pics before noon 🙏 
						<span class="time">12:03</span>
					</div>
					
					<div class="message sent">
						Send now lol 😂 <span class="time">12:03</span>
					</div>
				</div>

				<div class="message-composer">
					<input type="text" placeholder="Type a message..." />
					<div class="icon image">
						<img src={imageBlack} alt="image" />
					</div>
					<div class="icon send">
						<img src={sendWhite} alt="send" />
					</div>
				</div> */}
			</main>

		</div>
	);
}