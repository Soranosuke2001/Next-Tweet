import type { User } from "@clerk/nextjs/dist/api";
import { clerkClient } from "@clerk/nextjs/server";
import { TRPCError } from "@trpc/server";
import { z } from "zod";

import { createTRPCRouter, publicProcedure } from "~/server/api/trpc";

// Filters the user info to only include the id, username, and profile image url
const filterUserClient = (user: User) => {
  return {
    id: user.id,
    username: user.username,
    profileImageUrl: user.profileImageUrl,
  };
};

export const postsRouter = createTRPCRouter({
  getAll: publicProcedure.query(async ({ ctx }) => {
    // Gets the first 100 posts
    const posts = await ctx.prisma.post.findMany({
      take: 100,
    });

    // Gets the user info for the first 100 posts
    const userInfo = await clerkClient.users.getUserList({
      userId: posts.map((post) => post.authorId),
      limit: 100,
    });

    const users = userInfo.map(filterUserClient);

    // Returns the posts and the user info
    return posts.map((post) => {
      // Check if there is an author for the post
      const author = users.find((user) => user.id === post.authorId);
      if (!author || !author.username) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Author for the post was not found",
        });
      } else {
        // Returns the post and the author if the author exists
        return {
          post,
          author: {
            ...author,
            username: author.username,
          },
        };
      }
    });
  }),
});
