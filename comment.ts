/* tslint:disable:no-console */
import { config } from "dotenv";
import { IgApiClient } from "instagram-private-api";

// Load environment variables from .env file
config();

const ig = new IgApiClient();

/**
 * Authenticates the global Instagram client using IG_USERNAME and IG_PASSWORD from the environment.
 *
 * Generates a device fingerprint for the configured username and performs account login via the shared `ig` client.
 *
 * @throws Error If either `IG_USERNAME` or `IG_PASSWORD` environment variables are not set.
 */
async function login() {
	if (!process.env.IG_USERNAME || !process.env.IG_PASSWORD) {
		throw new Error("IG_USERNAME and IG_PASSWORD must be set");
	}

	ig.state.generateDevice(process.env.IG_USERNAME);
	await ig.account.login(process.env.IG_USERNAME, process.env.IG_PASSWORD);
}

(async () => {
	// basic login-procedure
	await login();

	const { broadcast_id } = await ig.live.create({
		// create a stream in 720x1280 (9:16)
		previewWidth: 720,
		previewHeight: 1280,
		// this message is not necessary, because it doesn't show up in the notification
		message: "My message",
	});

	/**
	 * make sure you are streaming to the url
	 * the next step will send a notification / start your stream for everyone to see
	 */
	const startInfo = await ig.live.start(broadcast_id);
	// status should be 'ok'
	console.log("Starting info:", startInfo);

	/**
	 * now, your stream is running
	 * the next step is to get comments
	 * note: comments can only be requested roughly every 2s
	 */

	// initial comment-timestamp = 0, get all comments
	let lastCommentTs = await printComments(broadcast_id, 0);

	// enable the comments
	await ig.live.unmuteComment(broadcast_id);
	/**
	 * wait 2 seconds until the next request.
	 * in the real world you'd use something like setInterval() instead of Bluebird.delay() / just to simulate a delay
	 */
	// wait 2s
	console.log("Waiting 2 seconds...");
	await new Promise((resolve) => setTimeout(resolve, 2000));
	// now, we print the next comments
	lastCommentTs = await printComments(broadcast_id, lastCommentTs);

	// now we're commenting on our stream
	console.log("Commenting on stream...");
	await ig.live.comment(broadcast_id, "A comment");

	// wait 2s
	console.log("Waiting 2 seconds...");
	await new Promise((resolve) => setTimeout(resolve, 2000));
	// now, we print the next comments
	lastCommentTs = await printComments(broadcast_id, lastCommentTs);

	/**
	 * now, your stream is running, you entertain your followers, but you're tired and
	 * we're going to stop the stream
	 */
	await ig.live.endBroadcast(broadcast_id);

	// now you're basically done
})();

/**
 * Fetches and prints new live comments for a broadcast and returns the most recent comment timestamp.
 *
 * Retrieves comments from the live broadcast since `lastCommentTs`, logs each as `username: text`,
 * and returns the `created_at` timestamp of the newest comment. If no new comments are found,
 * the original `lastCommentTs` is returned.
 *
 * @param broadcastId - The live broadcast ID to fetch comments for.
 * @param lastCommentTs - Timestamp (in seconds) of the last-processed comment; used as the lower bound for fetching.
 * @returns The `created_at` timestamp of the latest fetched comment, or `lastCommentTs` if there were no new comments.
 */
async function printComments(broadcastId: string, lastCommentTs: number) {
	const { comments } = await ig.live.getComment({ broadcastId, lastCommentTs });

	if (comments.length > 0) {
		comments.forEach((comment) =>
			console.log(`${comment.user.username}: ${comment.text}`),
		);

		return comments[comments.length - 1].created_at;
	} else {
		return lastCommentTs;
	}
}
