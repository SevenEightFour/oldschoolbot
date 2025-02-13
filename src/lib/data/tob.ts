import { calcPercentOfNum, calcWhatPercent, randFloat, randInt, reduceNumByPercent, round, Time } from 'e';
import { Bank } from 'oldschooljs';
import { randomVariation } from 'oldschooljs/dist/util';

import type { GearStats } from '../gear/types';
import { blowpipeDarts } from '../minions/functions/blowpipeCommand';
import { constructGearSetup, Gear } from '../structures/Gear';
import getOSItem from '../util/getOSItem';
import { assert, logError } from '../util/logError';
import resolveItems from '../util/resolveItems';

export interface TOBRoom {
	name: string;
	difficultyRating: number;
	timeWeighting: number;
}
export const TOBRooms: TOBRoom[] = [
	{
		name: 'Maiden',
		difficultyRating: 1,
		timeWeighting: 11
	},
	{
		name: 'Bloat',
		difficultyRating: 4,
		timeWeighting: 11
	},
	{
		name: 'Nylocas',
		difficultyRating: 3,
		timeWeighting: 22
	},
	{
		name: 'Sotetseg',
		difficultyRating: 2,
		timeWeighting: 11
	},
	{
		name: 'Xarpus',
		difficultyRating: 2,
		timeWeighting: 17
	},
	{
		name: 'Verzik',
		difficultyRating: 6,
		timeWeighting: 28
	}
];

interface TOBDeaths {
	/**
	 * An array, where each item is the index of the room they died in.
	 */
	deaths: number[]; // If they actually died or not
	wipeDeaths: number[]; // Used to determine wipe chance
	deathChances: { name: string; deathChance: number }[];
	wipeDeathChances: { name: string; deathChance: number }[];
}

export function calculateTOBDeaths(
	kc: number,
	hardKC: number,
	attempts: number,
	hardAttempts: number,
	isHardMode: boolean,
	gear: {
		melee: number;
		range: number;
		mage: number;
		total: number;
	}
): TOBDeaths {
	let deaths: number[] = [];
	let wipeDeaths: number[] = [];
	let realDeathChances: { name: string; deathChance: number }[] = [];
	let wipeDeathChances: { name: string; deathChance: number }[] = [];

	// These numbers are for proficiency. After this point, the odds of a wipe are the same, but deaths are reduced.
	const minionProfiencyKC = isHardMode ? 75 : 50;
	const actualDeathReductionFactor = isHardMode ? 3 : 4;

	// This shifts the graph left or right, to start getting kc sooner or later. Higher = sooner:
	const minionLearningBase = isHardMode ? 5 : 2;
	const minionLearning = minionLearningBase + Math.floor(Math.min(20, (isHardMode ? hardAttempts : attempts) / 2));
	const basePosition = isHardMode ? 92 : 85;
	const difficultySlider = isHardMode ? 34 : 36; // Lower is harder. Be careful with this. (30 default).
	const curveStrength = isHardMode ? 1.5 : 2.5; // 1 - 5. Higher numbers mean a slower learning curve. (2.5 default)
	const baseKC = isHardMode ? hardKC : kc;

	let baseDeathChance = Math.floor(
		basePosition - (Math.log(baseKC / curveStrength + minionLearning) / Math.log(Math.sqrt(100))) * difficultySlider
	);

	baseDeathChance = Math.max(Math.min(baseDeathChance, 99.9), 3);

	if (gear.total < 75) {
		baseDeathChance = 100;
	}
	for (const setup of [gear.mage, gear.melee, gear.range]) {
		if (setup < 80) {
			baseDeathChance += (80 - setup) * 2;
		}
	}

	for (let i = 0; i < TOBRooms.length; i++) {
		const room = TOBRooms[i];
		const wipeDeathChance = Math.min(98, (1 + room.difficultyRating / 10) * baseDeathChance);
		const realDeathChance =
			baseKC >= minionProfiencyKC ? wipeDeathChance / actualDeathReductionFactor : wipeDeathChance;
		const roll = randFloat(0, 100);
		if (roll < realDeathChance) {
			deaths.push(i);
		}
		if (roll < wipeDeathChance) {
			wipeDeaths.push(i);
		}
		realDeathChances.push({ name: room.name, deathChance: realDeathChance });
		wipeDeathChances.push({ name: room.name, deathChance: wipeDeathChance });
	}

	return { deaths, wipeDeaths, deathChances: realDeathChances, wipeDeathChances };
}

export const baseTOBUniques = resolveItems([
	'Scythe of vitur (uncharged)',
	'Ghrazi rapier',
	'Sanguinesti staff (uncharged)',
	'Justiciar faceguard',
	'Justiciar chestguard',
	'Justiciar legguards',
	'Avernic defender hilt'
]);

export const TOBUniques = resolveItems([
	...baseTOBUniques,
	"Lil' zik",
	'Sanguine dust',
	'Sanguine ornament kit',
	'Holy ornament kit'
]);

export const TOBUniquesToAnnounce = resolveItems([
	'Scythe of vitur (uncharged)',
	'Ghrazi rapier',
	'Sanguinesti staff (uncharged)',
	'Justiciar faceguard',
	'Justiciar chestguard',
	'Justiciar legguards',
	"Lil' zik",
	'Sanguine dust',
	'Sanguine ornament kit',
	'Holy ornament kit'
]);

function calcSetupPercent(
	maxStats: GearStats,
	userStats: GearStats,
	heavyPenalizeStat: keyof GearStats,
	ignoreStats: (keyof GearStats)[],
	melee: boolean
) {
	let numKeys = 0;
	let totalPercent = 0;
	for (const [key, val] of Object.entries(maxStats) as [keyof GearStats, number][]) {
		if (val <= 0 || ignoreStats.includes(key)) continue;
		const rawPercent = Math.min(100, calcWhatPercent(userStats[key], val));
		totalPercent += rawPercent;
		numKeys++;
	}
	// For melee compare the highest melee attack stat of max setup with the highest melee attack stat of the user
	if (melee) {
		let maxMeleeStat = Math.max(
			maxStats['attack_stab'],
			Math.max(maxStats['attack_slash'], maxStats['attack_crush'])
		);
		let userMeleeStat = Math.max(
			userStats['attack_stab'],
			Math.max(userStats['attack_slash'], userStats['attack_crush'])
		);
		totalPercent += Math.min(100, calcWhatPercent(userMeleeStat, maxMeleeStat));
		numKeys++;
	}
	totalPercent /= numKeys;
	// Heavy penalize for having less than 50% in the main stat of this setup.
	if (userStats[heavyPenalizeStat] < maxStats[heavyPenalizeStat] / 2) {
		totalPercent = Math.floor(Math.max(0, totalPercent / 2));
	}
	return totalPercent;
}

export const TOBMaxMageGear = constructGearSetup({
	head: 'Ancestral hat',
	neck: 'Occult necklace',
	body: 'Ancestral robe top',
	cape: 'Imbued saradomin cape',
	hands: 'Tormented bracelet',
	legs: 'Ancestral robe bottom',
	feet: 'Eternal boots',
	weapon: 'Kodai wand',
	shield: 'Arcane spirit shield',
	ring: 'Seers ring(i)'
});
const maxMage = new Gear(TOBMaxMageGear);

export const TOBMaxRangeGear = constructGearSetup({
	head: 'Void ranger helm',
	neck: 'Necklace of anguish',
	body: 'Elite void top',
	cape: "Ava's assembler",
	hands: 'Void knight gloves',
	legs: 'Elite void robe',
	feet: 'Pegasian boots',
	'2h': 'Twisted bow',
	ring: 'Archers ring(i)',
	ammo: 'Dragon arrow'
});
const maxRange = new Gear(TOBMaxRangeGear);
maxRange.ammo!.quantity = 10_000;

export const TOBMaxMeleeGear = constructGearSetup({
	head: 'Torva full helm',
	neck: 'Amulet of torture',
	body: 'Torva platebody',
	cape: 'Infernal cape',
	hands: 'Ferocious gloves',
	legs: 'Torva platelegs',
	feet: 'Primordial boots',
	'2h': 'Scythe of vitur',
	ring: 'Berserker ring(i)'
});
const maxMelee = new Gear(TOBMaxMeleeGear);

export function calculateTOBUserGearPercents(user: MUser) {
	const melee = calcSetupPercent(
		maxMelee.stats,
		user.gear.melee.stats,
		'melee_strength',
		['attack_stab', 'attack_slash', 'attack_crush', 'attack_ranged', 'attack_magic'],
		true
	);
	const range = calcSetupPercent(
		maxRange.stats,
		user.gear.range.stats,
		'ranged_strength',
		['attack_stab', 'attack_slash', 'attack_crush', 'attack_magic'],
		false
	);
	const mage = calcSetupPercent(
		maxMage.stats,
		user.gear.mage.stats,
		'magic_damage',
		['attack_stab', 'attack_slash', 'attack_crush', 'attack_ranged'],
		false
	);
	return {
		melee,
		range,
		mage,
		total: (melee + range + mage) / 3
	};
}

export const minimumTOBSuppliesNeeded = new Bank({
	'Saradomin brew(4)': 10,
	'Super restore(4)': 5
});

export const TENTACLE_CHARGES_PER_RAID = 400;

function kcEffectiveness(normalKC: number, hardKC: number, hardMode: boolean) {
	const kc = hardMode ? hardKC : normalKC;
	let cap = 400;
	if (hardMode) {
		cap = 100;
	}
	const kcEffectiveness = Math.min(100, calcWhatPercent(kc, cap));
	return kcEffectiveness;
}

const speedReductionForGear = 16;
const speedReductionForKC = 40;
const totalSpeedReductions = speedReductionForGear + speedReductionForKC + 15 + 4;
const baseDuration = Time.Minute * 70;
const baseCmDuration = Time.Minute * 75;

const { ceil } = Math;
function calcPerc(perc: number, num: number) {
	return ceil(calcPercentOfNum(ceil(perc), num));
}
interface ParsedTeamMember {
	id: string;
	kc: number;
	hardKC: number;
	deathChances: TOBDeaths;
	deaths: number[];
	wipeDeaths: number[];
}

export function createTOBTeam({
	team,
	hardMode,
	disableVariation
}: {
	team: {
		user: MUser;
		gear: { melee: Gear; range: Gear; mage: Gear };
		bank: Bank;
		kc: number;
		hardKC: number;
		attempts: number;
		hardAttempts: number;
	}[];
	hardMode: boolean;
	disableVariation?: true;
}): {
	reductions: Record<string, number>;
	duration: number;
	totalReduction: number;
	parsedTeam: ParsedTeamMember[];
	wipedRoom: TOBRoom | null;
	deathDuration: number | null;
} {
	const teamSize = team.length;
	const maxScaling = 350;
	assert(teamSize > 1 && teamSize < 6, 'TOB team must be 2-5 users');

	let individualReductions = [];

	let reductions: Record<string, number> = {};

	let parsedTeam: ParsedTeamMember[] = [];

	for (const u of team) {
		let userPercentChange = 0;

		// Reduce time for gear
		const gearPerecents = calculateTOBUserGearPercents(u.user);
		// Blowpipe
		const darts = u.user.blowpipe.dartID!;
		const dartItem = getOSItem(darts);
		const dartIndex = blowpipeDarts.indexOf(dartItem);
		const blowPipePercent = dartIndex >= 3 ? dartIndex * 0.9 : -(4 * (4 - dartIndex));
		userPercentChange += calcPerc(gearPerecents.total, (speedReductionForGear + blowPipePercent) / 2);

		// Reduce time for KC
		const kcPercent = kcEffectiveness(
			Math.min(u.attempts, maxScaling),
			Math.min(u.hardAttempts, maxScaling),
			hardMode
		);
		userPercentChange += calcPerc(kcPercent, speedReductionForKC);

		const maxKcCurveBonus = 30;
		const durationCurveModifier = Math.min(maxKcCurveBonus, kcPercent * 0.6);
		userPercentChange *= 1 + durationCurveModifier / 100;

		/**
		 *
		 * Item/Gear Boosts
		 *
		 */
		const meleeWeaponBoosts = [
			['Scythe of vitur', 15],
			['Scythe of vitur (uncharged)', 6],
			['Blade of saeldor (c)', 6],
			['Abyssal tentacle', 5.5]
		] as const;
		for (const [name, percent] of meleeWeaponBoosts) {
			if (u.gear.melee.hasEquipped(name)) {
				userPercentChange += percent;
				break;
			}
		}
		const rangeWeaponBoosts = [['Twisted bow', 4]] as const;
		for (const [name, percent] of rangeWeaponBoosts) {
			if (u.gear.range.hasEquipped(name)) {
				userPercentChange += percent;
				break;
			}
		}
		const primarySpecWeaponBoosts = [
			['Dragon claws', 6],
			['Crystal halberd', 3]
		] as const;
		for (const [name, percent] of primarySpecWeaponBoosts) {
			if (u.user.hasEquippedOrInBank(name)) {
				userPercentChange += percent;
				break;
			}
		}
		const secondarySpecWeaponBoosts = [
			['Dragon warhammer', 6],
			['Bandos godsword', 3]
		] as const;
		for (const [name, percent] of secondarySpecWeaponBoosts) {
			if (u.user.hasEquippedOrInBank(name)) {
				userPercentChange += percent;
				break;
			}
		}

		const regularVoid = resolveItems([
			'Void knight top',
			'Void knight robe',
			'Void knight gloves',
			'Void ranger helm'
		]);
		const eliteVoid = resolveItems(['Elite void top', 'Elite void robe', 'Void knight gloves', 'Void ranger helm']);
		if (!u.gear.range.hasEquipped(regularVoid, true, true)) {
			userPercentChange = reduceNumByPercent(userPercentChange, 20);
		} else if (!u.gear.range.hasEquipped(eliteVoid, true, true)) {
			userPercentChange = reduceNumByPercent(userPercentChange, 10);
		}

		const deathChances = calculateTOBDeaths(u.kc, u.hardKC, u.attempts, u.hardAttempts, hardMode, gearPerecents);
		parsedTeam.push({
			kc: u.kc,
			hardKC: u.hardKC,
			deathChances,
			wipeDeaths: deathChances.wipeDeaths,
			deaths: deathChances.deaths,
			id: u.user.id
		});

		let reduction = round(userPercentChange / teamSize, 1);

		individualReductions.push(userPercentChange);
		reductions[u.user.id] = reduction;
	}
	let duration = baseDuration;

	// Get the sum of individualReductions array
	let totalReduction = individualReductions.reduce((a, c) => a + c);

	// Remove the worst player from speed calculation if team size > 2:
	if (teamSize > 2) {
		totalReduction -= Math.min(...individualReductions);
		totalReduction = round(totalReduction / (teamSize - 1), 2);
	} else {
		totalReduction = round(totalReduction / teamSize, 2);
	}
	if (hardMode) {
		duration = baseCmDuration;
		duration = reduceNumByPercent(duration, totalReduction / 1.3);
	} else {
		duration = reduceNumByPercent(duration, totalReduction);
	}

	if (duration < Time.Minute * 20) {
		duration = Math.max(Time.Minute * 20, duration);
	}

	if (team.length < 5) {
		duration += (5 - team.length) * (Time.Minute * 1.3);
	}

	duration = Math.floor(randomVariation(duration, 5));

	let wipedRoom: TOBRoom | null = null;
	let deathDuration: number | null = 0;
	for (let i = 0; i < TOBRooms.length; i++) {
		let room = TOBRooms[i];

		if (parsedTeam.every(member => member.wipeDeaths.includes(i))) {
			wipedRoom = room;
			deathDuration += Math.floor(
				calcPercentOfNum(disableVariation ? room.timeWeighting / 2 : randInt(1, room.timeWeighting), duration)
			);
			break;
		} else {
			deathDuration += Math.floor(calcPercentOfNum(room.timeWeighting, duration));
		}
	}

	if (!wipedRoom) deathDuration = null;

	if (wipedRoom !== null && (!TOBRooms.includes(wipedRoom) || [-1].includes(TOBRooms.indexOf(wipedRoom)))) {
		logError(new Error('Had non-existant wiped room for tob'), {
			room: JSON.stringify(wipedRoom),
			team: JSON.stringify(parsedTeam)
		});
		wipedRoom = null;
	}

	return {
		duration,
		reductions,
		totalReduction: totalSpeedReductions / teamSize,
		parsedTeam,
		wipedRoom,
		deathDuration
	};
}
