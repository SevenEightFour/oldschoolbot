import { MessageEmbed, TextChannel } from 'discord.js';
import { chunk, percentChance, randArrItem, shuffleArr, Time } from 'e';
import { KlasaClient } from 'klasa';
import { Bank, LootTable } from 'oldschooljs';
import { createQueryBuilder } from 'typeorm';

import { production } from '../config';
import { treatTable } from '../tasks/minions/trickOrTreatActivity';
import { Activity, getScaryFoodFromBank, scaryEatables } from './constants';
import { BossInstance, BossOptions, BossUser } from './structures/Boss';
import { Gear } from './structures/Gear';
import { ActivityTable } from './typeorm/ActivityTable.entity';
import { BossEventTable } from './typeorm/BossEventTable.entity';
import { NewBossOptions } from './types/minions';
import { formatDuration } from './util';
import { sendToChannelID } from './util/webhook';
import { LampTable } from './xpLamps';

interface BossEvent {
	id: number;
	name: string;
	bossOptions: Omit<BossOptions, 'leader' | 'channel' | 'massText' | 'settingsKeys'>;
	handleFinish: (client: KlasaClient, options: NewBossOptions, bossUsers: BossUser[]) => Promise<void>;
}

export const bossEventChannelID = production ? '897170239333220432' : '895410639835639808';
let PUMPKINHEAD_HEALING_NEEDED = 60;
export const PUMPKINHEAD_ID = 93_898_458;
const pumpkinHeadDescriptors = [
	['Head', 'Skull', 'Body', 'Minion'],
	['Crushing', 'Slashing', 'Chopping', 'Destroying', 'Stomping', 'Ripping', 'Slicing', 'Stabbing']
];
function getPHeadDescriptor() {
	const first = randArrItem(pumpkinHeadDescriptors[0]);
	const second = randArrItem(pumpkinHeadDescriptors[1]);
	return `${first}-${second}`;
}

export const pumpkinHeadUniqueTable = new LootTable()
	.add('Haunted cloak', 1, 2)
	.add("Pumpkinhead's headbringer")
	.add('Haunted amulet')
	.add('Haunted gloves', 1, 2)
	.add('Haunted boots', 1, 2)
	.add("Pumpkinhead's pumpkin head")
	.tertiary(60, 'Mini Pumpkinhead');

const nonUniqueTable = new LootTable().every(treatTable, [1, 6]).tertiary(15, "Choc'rock");

export const bossEvents: BossEvent[] = [
	{
		id: PUMPKINHEAD_ID,
		name: 'Pumpkinhead',
		handleFinish: async (client, data, bossUsers) => {
			const lootElligible = shuffleArr(bossUsers.filter(i => !percentChance(i.deathChance)));
			let userLoot: Record<string, Bank> = {};
			for (const i of lootElligible) {
				userLoot[i.user.id] = new Bank();
				userLoot[i.user.id].add(nonUniqueTable.roll());
				await i.user.incrementMonsterScore(PUMPKINHEAD_ID, 1);
			}

			const lootGroups = chunk(lootElligible, 5).filter(i => i.length === 5);
			const uniqueItemRecipients = lootGroups.map(groupArr => randArrItem(groupArr));
			let uniqueLootStr = [];
			for (const recip of uniqueItemRecipients) {
				const items = pumpkinHeadUniqueTable.roll();
				uniqueLootStr.push(`${recip.user} got ${items}`);
				userLoot[recip.user.id].add(items);
			}

			const specialLootRecipient = randArrItem(lootElligible);
			const specialLoot = new Bank()
				.add('Holiday mystery box')
				.add(LampTable.roll())
				.add(
					new LootTable()
						.add('Clue scroll (hard)', 1, 20)
						.add('Clue scroll (elite)', 1, 10)
						.add('Clue scroll (master)', 1, 5)
						.add('Clue scroll (Grandmaster)', 1, 2)
						.roll()
				);
			userLoot[specialLootRecipient.user.id].add(specialLoot);

			for (const [id, bank] of Object.entries(userLoot)) {
				const user = bossUsers.find(u => u.user.id === id)!;
				await user.user.addItemsToBank(bank, true);
			}

			sendToChannelID(client, data.channelID, {
				content: `<@&896845245873025067> **Your Group Finished Fighting Pumpkinhead the Pumpkinheaded Horror!**

*Everyone* received some Halloween candy!
${specialLootRecipient.user.username} received ${specialLoot}.
${uniqueLootStr.length > 0 ? `**Unique Loot:** ${uniqueLootStr.join(', ')}` : 'Nobody received any unique items!'}`
			});
		},
		bossOptions: {
			id: PUMPKINHEAD_ID,
			baseDuration: Time.Hour,
			skillRequirements: {},
			itemBoosts: [],
			customDenier: async user => {
				const foodRequired = getScaryFoodFromBank(user.bank(), PUMPKINHEAD_HEALING_NEEDED);
				if (!foodRequired) {
					return [
						true,
						`Not enough food! You need special spooky food to fight Pumpkinhead: ${scaryEatables
							.map(i => `${i.item.name} (${i.healAmount} HP)`)
							.join(', ')}`
					];
				}
				return [false];
			},
			bisGear: new Gear(),
			gearSetup: 'melee',
			itemCost: async data => {
				const foodRequired = getScaryFoodFromBank(data.user.bank(), PUMPKINHEAD_HEALING_NEEDED);
				if (!foodRequired) {
					let fakeBank = new Bank();
					for (const { item } of scaryEatables) fakeBank.add(item.id, 100);
					return getScaryFoodFromBank(fakeBank, PUMPKINHEAD_HEALING_NEEDED) as Bank;
				}

				return foodRequired;
			},
			mostImportantStat: 'attack_crush',
			food: () => new Bank(),
			activity: Activity.BossEvent,
			minSize: production ? 5 : 1,
			solo: false,
			canDie: true,
			customDeathChance: () => {
				return 5;
			},
			quantity: 1,
			allowMoreThan1Solo: false,
			allowMoreThan1Group: false,
			automaticStartTime: production ? Time.Minute * 10 : Time.Minute,
			maxSize: 250
		}
	}
];

export async function bossActiveIsActiveOrSoonActive(id?: string) {
	const results = await ActivityTable.find({
		where: {
			completed: false,
			type: Activity.BossEvent
		}
	});

	const query = createQueryBuilder(BossEventTable)
		.select()
		.where('completed = false')
		.andWhere("start_date < (now() + interval '20 minutes')");
	if (id) {
		query.andWhere(`id != ${id}`);
	}

	const otherResults = await query.getMany();

	console.log({ results, otherResults });

	return results.length > 0 || otherResults.length > 0;
}

export async function startBossEvent({ boss, client, id }: { boss: BossEvent; client: KlasaClient; id?: string }) {
	if (await bossActiveIsActiveOrSoonActive(id)) {
		throw new Error('There is already a boss event activity going on.');
	}
	const channel = client.channels.cache.get(bossEventChannelID) as TextChannel;
	const instance = new BossInstance({
		...boss.bossOptions,
		channel,
		massText: `<@&896845245873025067> Pumpkinhead the Pumpkinheaded ${getPHeadDescriptor()} ${getPHeadDescriptor()} Horror has spawned! Who will fight him?!`,
		quantity: 1
	});
	try {
		const { bossUsers } = await instance.start();
		const embed = new MessageEmbed()
			.setDescription(
				`A group of ${bossUsers.length} users is off to fight ${
					boss.name
				}, good luck! The total trip will take ${formatDuration(instance.duration)}.`
			)
			.setImage('https://cdn.discordapp.com/attachments/357422607982919680/896527691849826374/PHEAD.png')
			.setColor('#ff9500');

		return channel.send({
			embeds: [embed],
			content: instance.boosts.length > 0 ? `**Boosts:** ${instance.boosts.join(', ')}.` : undefined,
			allowedMentions: {
				roles: ['896845245873025067']
			}
		});
	} catch (err: unknown) {
		client.wtf(err as Error);
	}
}
