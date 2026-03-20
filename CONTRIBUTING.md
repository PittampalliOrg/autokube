# Contributing to AutoKube

Thank you for your interest in contributing to AutoKube! This document provides guidelines and instructions for contributing to the project.

## Table of Contents

- [Code of Conduct](#code-of-conduct)
- [Getting Started](#getting-started)
- [Development Setup](#development-setup)
- [Project Structure](#project-structure)
- [Development Workflow](#development-workflow)
- [Code Style Guidelines](#code-style-guidelines)
- [Testing](#testing)
- [Submitting Changes](#submitting-changes)
- [Reporting Bugs](#reporting-bugs)
- [Feature Requests](#feature-requests)
- [Documentation](#documentation)

## Code of Conduct

We are committed to providing a welcoming and inclusive environment for all contributors. Please be respectful, constructive, and professional in all interactions.

### Our Standards

- ✅ Use welcoming and inclusive language
- ✅ Respect differing viewpoints and experiences
- ✅ Accept constructive criticism gracefully
- ✅ Focus on what's best for the community
- ❌ No harassment, trolling, or personal attacks
- ❌ No publishing others' private information

## Getting Started

### Prerequisites

Before you begin, ensure you have:

- **Bun** v1.0+ installed ([installation guide](https://bun.sh))
- **Git** for version control
- A **Kubernetes cluster** for testing (minikube, k3d, or cloud provider)
- **kubectl** configured with cluster access
- Code editor (VS Code recommended)

### First-Time Setup

1. **Fork the repository** on GitHub
2. **Clone your fork** locally:
   ```bash
   git clone https://github.com/YOUR_USERNAME/autokube-v5.git
   cd autokube-v5
   ```

3. **Add upstream remote**:
   ```bash
   git remote add upstream https://github.com/ORIGINAL_OWNER/autokube-v5.git
   ```

4. **Install dependencies**:
   ```bash
   bun install
   ```

5. **Set up the database**:
   ```bash
   # SQLite (default) - no additional setup needed
   # Or configure PostgreSQL via DATABASE_URL environment variable
   bun run db:push
   ```

6. **Start development server**:
   ```bash
   bun run dev
   ```

7. **Open your browser** to `http://localhost:5173`

## Development Setup

### Environment Variables

Create a `.env` file (optional - defaults work out of the box):

```bash
# Database (defaults to SQLite at ./data/db/autokube.db)
DATABASE_URL=postgresql://user:pass@localhost:5432/autokube

# Data directory (defaults to ./data)
DATA_DIR=./data

# Encryption key (auto-generated if not provided)
ENCRYPTION_KEY=your-base64-encoded-32-byte-key

# Disable TLS verification for development (self-signed certs)
NODE_TLS_REJECT_UNAUTHORIZED=0
```

### Database Options

**SQLite (Default)**
```bash
# No configuration needed - auto-creates at ./data/db/autokube.db
bun run db:push
```

**PostgreSQL**
```bash
# Set DATABASE_URL and run migrations
export DATABASE_URL="postgresql://user:pass@localhost:5432/autokube"
bun run db:migrate
```

### Development Commands

```bash
bun run dev          # Start dev server (http://localhost:5173)
bun run build        # Production build
bun run start        # Start production build
bun run check        # Type checking (run before committing!)
bun run lint         # Prettier + ESLint check
bun run format       # Auto-format code
bun run db:push      # Apply schema changes (dev only)
bun run db:generate  # Generate migration files
bun run db:migrate   # Run migrations
bun run db:studio    # Open Drizzle Studio for database inspection
```

## Project Structure

```
autokube-v5/
├── src/
│   ├── lib/
│   │   ├── components/          # Svelte components
│   │   │   ├── ui/              # shadcn-svelte primitives
│   │   │   ├── dashboard/       # Dashboard widgets
│   │   │   ├── data-table-view/ # TanStack Table components
│   │   │   └── *.svelte         # Custom components (kebab-case)
│   │   ├── stores/              # Svelte 5 rune-based stores (*.svelte.ts)
│   │   ├── server/
│   │   │   ├── db/              # Database schema and client
│   │   │   ├── queries/         # Database query layer
│   │   │   └── services/        # Business logic and K8s clients
│   │   └── utils/               # Utility functions
│   ├── routes/
│   │   ├── (app)/               # Protected app routes
│   │   ├── api/                 # REST API endpoints
│   │   └── login/               # Auth pages
│   └── hooks.server.ts          # SvelteKit server hooks
├── config/                      # Vite plugins and build config
├── drizzle/                     # Database migrations
└── docs/                        # Documentation
```

## Development Workflow

### Branching Strategy

1. **Create a feature branch** from `main`:
   ```bash
   git checkout main
   git pull upstream main
   git checkout -b feature/your-feature-name
   ```

2. **Make your changes** with clear, atomic commits

3. **Keep your branch updated**:
   ```bash
   git fetch upstream
   git rebase upstream/main
   ```

### Commit Messages

Follow [Conventional Commits](https://www.conventionalcommits.org/):

```
<type>(<scope>): <description>

[optional body]

[optional footer]
```

**Types:**
- `feat`: New feature
- `fix`: Bug fix
- `docs`: Documentation changes
- `style`: Code style changes (formatting)
- `refactor`: Code refactoring
- `perf`: Performance improvements
- `test`: Adding or updating tests
- `chore`: Build process or tooling changes

**Examples:**
```
feat(clusters): add support for EKS cluster provisioning
fix(auth): resolve session expiration issue
docs(readme): update installation instructions
refactor(stores): migrate to Svelte 5 runes
```

## Code Style Guidelines

### TypeScript & Svelte

**Use Svelte 5 runes** - NO Svelte 4 syntax:

```svelte
<script lang="ts">
  // ✅ Correct - Svelte 5 runes
  let { open = $bindable(false), cluster, onSuccess }: Props = $props();
  let saving = $state(false);
  let errors = $state<FormErrors>({});
  const isEditMode = $derived(!!cluster);

  $effect(() => {
    if (open) resetForm();
  });

  // ❌ Wrong - Svelte 4 syntax
  export let open = false;  // Don't use export let
  $: isEditMode = !!cluster;  // Don't use $: reactive statements
</script>
```

**Key Patterns:**
- Props: `let { prop } = $props()`
- State: `let value = $state(initialValue)`
- Computed: `const computed = $derived(expression)`
- Side effects: `$effect(() => { ... })`
- Bindable props: `let { value = $bindable() } = $props()`

### Component Naming

- **Files**: `kebab-case.svelte` (e.g., `cluster-dialog.svelte`)
- **Stores**: `name.svelte.ts` (e.g., `clusters.svelte.ts`)
- **Components**: PascalCase in code

### Styling with Tailwind

Use the `cn()` utility from `$lib/utils.ts`:

```svelte
<div class={cn("base-classes", conditionalClass && "conditional-classes", className)}>
```

**Icons** - Use `lucide-svelte` exclusively:
```svelte
import { Check } from 'lucide-svelte';

<Check class="size-4" />  <!-- Always size-4, size-5, or size-3 -->
```

### API Endpoints

Follow the canonical pattern in `src/routes/api/`:

```typescript
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { authorize } from '$lib/server/services/authorize';
import { logAuditEvent } from '$lib/server/services/audit';

export const POST: RequestHandler = async ({ request, cookies, getClientAddress }) => {
  // 1. Authorize
  const auth = await authorize(cookies);
  if (auth.authEnabled && !await auth.can('resource', 'create')) {
    return json({ error: 'Permission denied' }, { status: 403 });
  }

  // 2. Validate input
  const body = await request.json();
  
  // 3. Perform operation
  const result = await createResource(body);

  // 4. Audit log (for mutations)
  await logAuditEvent({
    username: auth.username,
    action: 'create',
    entityType: 'resource',
    entityId: result.id,
    ipAddress: getClientAddress(),
    userAgent: request.headers.get('user-agent')
  });

  // 5. Return safe response (strip sensitive fields)
  return json({ resource: safeResource(result) });
};
```

### Database Changes

**Schema changes** require updates to BOTH schema files:
1. `src/lib/server/db/schema-sqlite.ts` (canonical)
2. `src/lib/server/db/schema-postgres.ts` (mirror changes)

**Generate migrations**:
```bash
bun run db:generate  # Creates migration files in drizzle/
bun run db:migrate   # Apply migrations
```

**Query layer** pattern:
- One file per entity in `src/lib/server/queries/`
- Decrypt on read, encrypt on write
- Use `mapClusterRow()` pattern for decryption

### Security Requirements

- **Never return encrypted fields** - Use `safeCluster()` pattern
- **Encrypt sensitive data** before DB write
- **Audit all mutations** with `logAuditEvent()`
- **RBAC gate endpoints** with `authorize()` and `auth.can()`
- **Validate all inputs** before processing

## Testing

Currently, AutoKube relies on type checking rather than automated tests:

```bash
bun run check  # TypeScript type checking - REQUIRED before submitting PR
```

**Manual Testing Checklist:**
- [ ] Test with SQLite database
- [ ] Test with PostgreSQL database
- [ ] Verify RBAC permissions work correctly
- [ ] Test with real Kubernetes cluster
- [ ] Check responsive design (mobile/tablet/desktop)
- [ ] Verify audit logs are created
- [ ] Test error handling and edge cases

## Submitting Changes

### Pull Request Process

1. **Ensure code quality**:
   ```bash
   bun run check   # Must pass!
   bun run lint    # Should have no errors
   bun run format  # Auto-fix formatting
   ```

2. **Update documentation** if needed

3. **Push to your fork**:
   ```bash
   git push origin feature/your-feature-name
   ```

4. **Create Pull Request** on GitHub:
   - Use a clear, descriptive title
   - Reference related issues (`Fixes #123`)
   - Describe what changed and why
   - Include screenshots for UI changes
   - Note any breaking changes

5. **Respond to review feedback** promptly

6. **Ensure CI passes** (type checking, linting)

### PR Title Format

```
<type>: <description> (#issue-number)
```

Examples:
- `feat: add bulk delete for clusters (#42)`
- `fix: resolve namespace filter bug (#123)`
- `docs: update installation guide`

### Review Process

- Maintainers will review PRs within 3-5 business days
- Address feedback with new commits (don't force push during review)
- PRs require at least one approval before merging
- Squash commits when merging to `main`

## Reporting Bugs

### Before Submitting

1. **Search existing issues** to avoid duplicates
2. **Test with latest version** from `main` branch
3. **Verify it's not a configuration issue**

### Bug Report Template

```markdown
**Describe the bug**
A clear description of what the bug is.

**To Reproduce**
Steps to reproduce:
1. Go to '...'
2. Click on '...'
3. See error

**Expected behavior**
What you expected to happen.

**Screenshots**
If applicable, add screenshots.

**Environment:**
- AutoKube version: [e.g., 5.0.1]
- Bun version: [e.g., 1.0.20]
- OS: [e.g., macOS 14.2]
- Database: [SQLite or PostgreSQL version]
- Kubernetes version: [e.g., 1.28.3]

**Additional context**
Any other relevant information.
```

## Feature Requests

We welcome feature suggestions! Please:

1. **Check existing requests** to avoid duplicates
2. **Describe the use case** - why is this needed?
3. **Propose a solution** if you have ideas
4. **Consider contributing** the feature yourself

### Feature Request Template

```markdown
**Is your feature request related to a problem?**
A clear description of the problem.

**Describe the solution you'd like**
What you want to happen.

**Describe alternatives you've considered**
Other solutions or features you've considered.

**Additional context**
Any other relevant information, mockups, or examples.
```

## Documentation

### Types of Documentation

1. **Code Comments**: For complex logic or non-obvious decisions
2. **README.md**: User-facing installation and usage
3. **IMPLEMENTATION.md**: Technical architecture decisions
4. **API Docs**: Document new endpoints or changes
5. **Inline JSDoc**: For public APIs and utility functions

### Documentation Standards

- Keep docs up-to-date with code changes
- Use clear, concise language
- Include code examples where helpful
- Add screenshots for UI features
- Document breaking changes prominently

## Getting Help

- **GitHub Discussions**: Ask questions and share ideas
- **GitHub Issues**: Report bugs or request features
- **Documentation**: Check `docs/` folder for guides
- **Code Examples**: Reference existing components as patterns

## Recognition

Contributors will be:
- Listed in release notes for their contributions
- Credited in the project README
- Thanked in the community

## License

By contributing to AutoKube, you agree that your contributions will be licensed under the same license as the project (see [LICENSE](LICENSE) file).

---

Thank you for contributing to AutoKube! 🚀

**Questions?** Open a discussion or reach out to the maintainers.
