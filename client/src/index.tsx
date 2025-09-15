import { render } from 'preact';
import { LocationProvider, Router, Route } from 'preact-iso';
import './style.css';
// providers
import { ClientProvider, useClient } from './shared/authContext.js';
import { ChatProvider } from './shared/chatContext.js';
import { SocketProvider } from './shared/webSocketContext.js';
import { UnreadProvider } from './shared/unreadMessagesContext';

// pages
import { Home } from './pages/Home/index.js';
import { NotFound } from './pages/_404.js';

// Mobile viewport height fix
function setViewportHeight() {
	const vh = window.innerHeight * 0.01;
	document.documentElement.style.setProperty('--vh', `${vh}px`);
}

// Set on load and resize
setViewportHeight();
window.addEventListener('resize', setViewportHeight);
window.addEventListener('orientationchange', () => {
	setTimeout(setViewportHeight, 100);
});


export function App(){
	return (
		<LocationProvider>

			<SocketProvider>
				<ClientProvider>
					<UnreadProvider>
						<ChatProvider>
				
							<InnerApp />

						</ChatProvider>
					</UnreadProvider>
				</ClientProvider>
			</SocketProvider>

		</LocationProvider>
	);
}

function InnerApp(){
	const { loading } = useClient();
	
	if(loading){
		return (
			<div className="loading-screen center-flex column">
				<div className="spinner"></div>
				<p>Loading…</p>
			</div>
		);
	}

	return (
		<main>
			<Router>
				<Route path="/" component={Home} />
				<Route default component={NotFound} />
			</Router>
		</main>
	)
}

render(<App />, document.getElementById('app'));