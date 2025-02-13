import { bulkUpdateCommands } from 'mahoji/dist/lib/util';
import { ItemBank } from 'oldschooljs/dist/meta/types';

import { CLIENT_ID, DEV_SERVER_ID, production } from '../../config';
import { cacheBadges } from '../../lib/badges';
import { syncBlacklists } from '../../lib/blacklists';
import { DISABLED_COMMANDS } from '../../lib/constants';
import { initCrons } from '../../lib/crons';
import { prisma } from '../../lib/settings/prisma';
import { initTickers } from '../../lib/tickers';
import { runTimedLoggedFn } from '../../lib/util';
import { cacheCleanup } from '../../lib/util/cachedUserIDs';
import { mahojiClientSettingsFetch } from '../../lib/util/clientSettings';
import { syncLinkedAccounts } from '../../lib/util/linkedAccountsUtil';
import { cacheUsernames } from '../commands/leaderboard';
import { CUSTOM_PRICE_CACHE } from '../commands/sell';

export async function syncCustomPrices() {
	const clientData = await mahojiClientSettingsFetch();
	for (const [key, value] of Object.entries(clientData.custom_prices as ItemBank)) {
		CUSTOM_PRICE_CACHE.set(Number(key), Number(value));
	}
}

export async function onStartup() {
	globalClient.application.commands.fetch({ guildId: production ? undefined : DEV_SERVER_ID });

	// Sync disabled commands
	const disabledCommands = await prisma.clientStorage.upsert({
		where: {
			id: CLIENT_ID
		},
		select: { disabled_commands: true },
		create: {
			id: CLIENT_ID
		},
		update: {}
	});

	for (const command of disabledCommands!.disabled_commands) {
		DISABLED_COMMANDS.add(command);
	}

	// Sync blacklists
	await syncBlacklists();

	if (!production) {
		console.log('Syncing commands locally...');
		await bulkUpdateCommands({
			client: globalClient.mahojiClient,
			commands: globalClient.mahojiClient.commands.values,
			guildID: DEV_SERVER_ID
		});
	}

	runTimedLoggedFn('Syncing prices', syncCustomPrices);

	runTimedLoggedFn('Caching badges', cacheBadges);
	runTimedLoggedFn('Cache Usernames', cacheUsernames);
	cacheCleanup();

	runTimedLoggedFn('Sync Linked Accounts', syncLinkedAccounts);

	initCrons();
	initTickers();
}
