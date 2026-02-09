# Code

- Always generate secure code
- Minimalism and easy to read code is required
- Make sure to not expose any api keys in the front end.
- Don't write code that can leak secrets, either in the repo or in the front-end on the browser / client side.

# Design

- Use shadcn and mapcn for styling.
- We need to maintain both a dark mode and light mode
- Styling should look elegant and professional.
- I want it to be able to be viewed on mobile and on desktop. 
- Mobile-first priority.


# Dev

- We are using PNPM
- Make sure all relevant commands you issue use PNPM
- Stop creating nul files when running commands
- Don't run dev servers. I will run them for you if needed, and most of the time they are already running.
- Make sure to solve all tree hydration errors