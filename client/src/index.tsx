import { render } from 'preact';
import { LocationProvider, Router, Route } from 'preact-iso';

import { Home } from './pages/Home/index.js';
import { NotFound } from './pages/_404.js';
import './style.css';
import { ClientProvider } from './shared/authContext.js';
import { ChatProvider } from './shared/chatContext.js';
import { SocketProvider } from './shared/webSocketContext.js';


export function App(){
	return (
		<LocationProvider>

			<SocketProvider>
				<ClientProvider>
					<ChatProvider>
			
						<main>
							<Router>
								<Route path="/" component={Home} />
								<Route default component={NotFound} />
							</Router>
						</main>

					</ChatProvider>
				</ClientProvider>
			</SocketProvider>

		</LocationProvider>
	);
}

render(<App />, document.getElementById('app'));