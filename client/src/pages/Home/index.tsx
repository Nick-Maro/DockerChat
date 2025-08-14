import './style.css';

// icons
import imageBlack from '../../assets/icons/image-black.svg';
import sendWhite from '../../assets/icons/send-white.svg';


export function Home() {
	return (
		<div class="home flex row">
			<section id="chats">
				<h2>Messages</h2>

				<ul class="flex column">
					<li class="active">
						<img src="https://placehold.co/50x50/845B92/FFF?text=G" alt="pfp" />
						<div class="info">
							<div class="name center-flex row">
								<h3> Giana Barr </h3>
								<p>12m</p>
							</div>
							<p class="last-msg">Send now lol 😂</p>
						</div>
					</li>
					<li>
						<img src="https://placehold.co/50x50/845B92/FFF?text=E" alt="pfp" />
						<h3> Aiden Pearce </h3>
					</li>
					<li>
						<img src="https://placehold.co/50x50/845B92/FFF?text=C" alt="pfp" />
						<h3> Cadence Acevedo </h3>
					</li>
					<li>
						<img src="https://placehold.co/50x50/845B92/FFF?text=L" alt="pfp" />
						<h3> Landry Yu </h3>
					</li>
					<li>
						<img src="https://placehold.co/50x50/845B92/FFF?text=L" alt="pfp" />
						<h3> Loretta Schmitt </h3>
					</li>
				</ul>
			</section>

			<main>
				<div class="header center-flex">
					<img src="https://placehold.co/50x50/845B92/FFF?text=G" alt="pfp" />
					<h2> Giana Barr </h2>
				</div>

				<div class="chat flex column">
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
				</div>
			</main>
		</div>
	);
}