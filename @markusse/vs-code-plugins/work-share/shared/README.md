# @work-share/types

Shared TypeScript type definitions for the Work Share project with validation decorators.

## Overview

This package contains all shared TypeScript classes with validation decorators used across:

- **Extension**: VS Code plugin (`@markusse/vs-code-plugins/work-share/extension`)
- **Server**: Node.js API server (`@markusse/server`)
- **Client**: React dashboard (`@markusse/client`)

All types are implemented as **classes** with `class-validator` and `class-transformer` decorators for runtime validation and transformation.

## Structure

```
shared/
├── src/
│   └── index.ts          # All type definitions with decorators
├── lib/                  # Compiled output (generated)
│   ├── index.js
│   ├── index.d.ts
│   └── *.map files
├── package.json
├── tsconfig.json
└── README.md
```

## Types Included

### Request DTOs

- `ActivityDto` - File activity event
- `ActivityBatchDto` - Batch of activities
- `PatchDto` - Code patch submission

### Response Types

- `StoredPatch` - Patch with server metadata
- `FileInfo` - File with active users and patches
- `RepositoryFilesInfo` - Repository aggregation

### API Responses

- `GetActivitiesResponse`
- `GetPatchesResponse`
- `GetFilesResponse`
- `PostActivitiesResponse`
- `PostPatchesResponse`
- `HealthCheckResponse`
- `ErrorResponse`

## Usage

### Basic Import

```typescript
import { ActivityDto, PatchDto } from "@work-share/types";
```

### With Validation (Server-side)

```typescript
import { ActivityDto } from "@work-share/types";
import { validate } from "class-validator";
import { plainToClass } from "class-transformer";

// Transform plain object to class instance
const activityDto = plainToClass(ActivityDto, {
    filePath: "/path/to/file.ts",
    userName: "John Doe",
    timestamp: new Date().toISOString(),
    action: "open",
    repositoryRemoteUrl: "https://github.com/org/repo.git",
});

// Validate the instance
const errors = await validate(activityDto);
if (errors.length > 0) {
    console.log("Validation failed:", errors);
} else {
    console.log("Validation passed!");
}
```

### With routing-controllers (Server-side)

The server already uses these decorators automatically via routing-controllers:

```typescript
import { JsonController, Post, Body } from "routing-controllers";
import { ActivityBatchDto } from "@work-share/types";

@JsonController()
export class ActivityController {
    @Post("/activities")
    async receiveActivities(@Body() body: ActivityBatchDto) {
        // body is automatically validated and transformed
        // routing-controllers uses class-validator internally
        return { success: true };
    }
}
```

## Validation Features

All types include the following decorators:

- `@IsString()` - Validates string properties
- `@IsNumber()` - Validates number properties
- `@IsBoolean()` - Validates boolean properties
- `@IsArray()` - Validates array properties
- `@IsIn([...])` - Validates enum values
- `@ValidateNested()` - Validates nested objects
- `@Type(() => Class)` - Transforms nested objects to class instances

## Development

```bash
# Build the types
npm run build

# Clean build output
npm run clean
```

## Dependencies

- `class-validator` (^0.14.0) - Runtime validation
- `class-transformer` (^0.5.1) - Plain object to class transformation
- `reflect-metadata` (^0.1.13) - Required for decorators

## TypeScript Configuration

Consuming packages must have these compiler options enabled:

```json
{
    "compilerOptions": {
        "experimentalDecorators": true,
        "emitDecoratorMetadata": true
    }
}
```

## Notes

- This is a **private** package (not published to npm)
- Used internally within the Work Share monorepo via npm workspaces
- Source is in `src/`, compiled output in `lib/`
- All types are **classes**, not interfaces, to support decorators
