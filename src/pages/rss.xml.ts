import rss from '@astrojs/rss';
import { getCollection } from 'astro:content';
import type { APIContext } from 'astro';

export async function GET(context: APIContext) {
	const posts = (await getCollection('blog'))
		.sort((a, b) => b.data.publishDate.valueOf() - a.data.publishDate.valueOf());

	return rss({
		title: 'Carlos Villanueva | Blog',
		description: 'Thoughts on software engineering, backend systems, and production code.',
		site: context.site!,
		items: posts.map(post => ({
			title: post.data.title,
			description: post.data.description,
			pubDate: new Date(post.data.publishDate),
			link: `${context.site}blog/${post.slug}/`,
		})),
		customData: `<language>en-us</language>`,
	});
}
