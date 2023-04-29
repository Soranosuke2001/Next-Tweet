import type { User } from "@clerk/nextjs/dist/api";
import { clerkClient } from "@clerk/nextjs/server";
import { TRPCError } from "@trpc/server";
import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";
import { z } from "zod";
import { filterUserForClient } from "~/server/helpers/filterUserForClient";

import {
  createTRPCRouter,
  privateProcedure,
  publicProcedure,
} from "~/server/api/trpc";
import { Post } from "@prisma/client";

const addUserDataToPosts = async (posts: Post[]) => {
  // Gets the user info for the first 100 posts
  const userInfo = await clerkClient.users.getUserList({
    userId: posts.map((post) => post.authorId),
    limit: 100,
  });

  const users = userInfo.map(filterUserForClient);

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
};

// Ratelimits the posts route to 3 requests per minute
const ratelimit = new Ratelimit({
  redis: Redis.fromEnv(),
  limiter: Ratelimit.slidingWindow(3, "1 m"),
  analytics: true,
});

export const postsRouter = createTRPCRouter({
  getById: publicProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ ctx, input }) => {
      const post = await ctx.prisma.post.findUnique({
        where: {
          id: input.id,
        },
      });

      if (!post) throw new TRPCError({ code: "NOT_FOUND" });

      return (await addUserDataToPosts([post]))[0];
    }),
    
  getAll: publicProcedure.query(async ({ ctx }) => {
    // Gets the first 100 posts
    const posts = await ctx.prisma.post.findMany({
      take: 100,
      orderBy: [{ createdAt: "desc" }],
    });

    return addUserDataToPosts(posts);
  }),

  getPostsByUserId: publicProcedure
    .input(z.object({ userId: z.string() }))
    .query(({ ctx, input }) =>
      ctx.prisma.post
        .findMany({
          where: {
            authorId: input.userId,
          },
          take: 100,
          orderBy: [{ createdAt: "desc" }],
        })
        .then(addUserDataToPosts)
    ),

  create: privateProcedure
    .input(
      z.object({
        // We can add custom error messages by passing in a string to the validation function
        content: z.string().emoji("Only Emoji's are accepted").min(1).max(280),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const authorId = ctx.userId;

      // Ratelimits the user
      const { success } = await ratelimit.limit(authorId);
      if (!success) throw new TRPCError({ code: "TOO_MANY_REQUESTS" });

      const post = await ctx.prisma.post.create({
        data: {
          authorId,
          content: input.content,
        },
      });

      return post;
    }),
});
