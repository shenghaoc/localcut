const MS_PER_SECOND = 1_000;
const MS_PER_MINUTE = 60 * MS_PER_SECOND;
const MS_PER_HOUR = 60 * MS_PER_MINUTE;
const MS_PER_DAY = 24 * MS_PER_HOUR;
const EPOCH_YEAR = 1970;
const DAYS_PER_400_YEARS = 146_097;

export function currentEpochMs(): number {
	return Math.floor(performance.timeOrigin + performance.now());
}

export function monotonicNowMs(): number {
	return performance.now();
}

function isLeapYear(year: number): boolean {
	return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}

function daysInYear(year: number): number {
	return isLeapYear(year) ? 366 : 365;
}

function daysInMonth(year: number, month: number): number {
	switch (month) {
		case 2:
			return isLeapYear(year) ? 29 : 28;
		case 4:
		case 6:
		case 9:
		case 11:
			return 30;
		default:
			return 31;
	}
}

function pad(value: number, width: number): string {
	return Math.trunc(value).toString().padStart(width, '0');
}

export function isoFromEpochMs(epochMs: number): string {
	if (!Number.isFinite(epochMs)) return '1970-01-01T00:00:00.000Z';
	let days = Math.floor(epochMs / MS_PER_DAY);
	let dayMs = epochMs - days * MS_PER_DAY;
	if (dayMs < 0) {
		dayMs += MS_PER_DAY;
		days -= 1;
	}
	let year = EPOCH_YEAR;
	if (days >= 0) {
		const cycles = Math.floor(days / DAYS_PER_400_YEARS);
		year += cycles * 400;
		days -= cycles * DAYS_PER_400_YEARS;
		while (days >= daysInYear(year)) days -= daysInYear(year++);
	} else {
		while (days < 0) days += daysInYear(--year);
	}
	let month = 1;
	while (days >= daysInMonth(year, month)) days -= daysInMonth(year, month++);
	const hour = Math.floor(dayMs / MS_PER_HOUR);
	dayMs -= hour * MS_PER_HOUR;
	const minute = Math.floor(dayMs / MS_PER_MINUTE);
	dayMs -= minute * MS_PER_MINUTE;
	const second = Math.floor(dayMs / MS_PER_SECOND);
	const millisecond = Math.floor(dayMs - second * MS_PER_SECOND);
	return `${pad(year, 4)}-${pad(month, 2)}-${pad(days + 1, 2)}T${pad(hour, 2)}:${pad(minute, 2)}:${pad(second, 2)}.${pad(millisecond, 3)}Z`;
}

export function currentIsoTimestamp(): string {
	return isoFromEpochMs(currentEpochMs());
}

export function isIsoTimestamp(value: string): boolean {
	return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value);
}

export function formatIsoForDisplay(value: string): string {
	if (!isIsoTimestamp(value)) return 'Generated';
	const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(value);
	if (!match) return 'Generated';
	const [, , month, day, hour, minute] = match;
	const monthName =
		['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][
			Number(month) - 1
		] ?? month;
	return `Generated ${monthName} ${Number(day)}, ${hour}:${minute} UTC`;
}
