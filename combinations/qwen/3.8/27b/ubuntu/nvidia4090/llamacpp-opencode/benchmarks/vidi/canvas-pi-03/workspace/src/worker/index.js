// Worker code arrives in story 3. For now, just serve static assets.
export default {
  async fetch(request, env, ctx) {
    return env.ASSETS.fetch(request);
  },
};
