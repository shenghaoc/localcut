export function appendSerialTask(
	chain: Promise<void>,
	task: () => Promise<void>,
	onError: (error: unknown) => void
): Promise<void> {
	return chain.then(task).catch((error) => {
		onError(error);
	});
}
