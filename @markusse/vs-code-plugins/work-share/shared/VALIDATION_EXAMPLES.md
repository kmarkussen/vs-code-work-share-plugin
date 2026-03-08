# Validation Examples

This document provides examples of using class-validator and class-transformer with the shared types.

## Server-Side Validation Example

### Manual Validation

```typescript
import { validate } from "class-validator";
import { plainToClass } from "class-transformer";
import { ActivityDto, ActivityBatchDto } from "@work-share/types";

// Example 1: Validate a single ActivityDto
async function validateActivity(plainObject: any) {
    // Transform plain object to class instance
    const activity = plainToClass(ActivityDto, plainObject);

    // Validate
    const errors = await validate(activity);

    if (errors.length > 0) {
        console.log("Validation errors:", errors);
        return null;
    }

    return activity;
}

// Example 2: Validate nested objects (ActivityBatchDto)
async function validateBatch(plainObject: any) {
    const batch = plainToClass(ActivityBatchDto, plainObject);
    const errors = await validate(batch, {
        validationError: { target: false },
        whitelist: true,
    });

    if (errors.length > 0) {
        const messages = errors.map((error) => Object.values(error.constraints || {})).flat();
        throw new Error(`Validation failed: ${messages.join(", ")}`);
    }

    return batch;
}

// Usage
const activityData = {
    filePath: "/path/to/file.ts",
    userName: "John Doe",
    timestamp: new Date().toISOString(),
    action: "open",
    repositoryRemoteUrl: "https://github.com/org/repo.git",
};

const validActivity = await validateActivity(activityData);
```

### With routing-controllers (Already Implemented in Server)

```typescript
import { JsonController, Post, Body, BadRequestError } from "routing-controllers";
import { ActivityBatchDto } from "@work-share/types";

@JsonController()
export class ActivityController {
    @Post("/activities")
    async receiveActivities(@Body() body: ActivityBatchDto) {
        // body is automatically validated by routing-controllers
        // Invalid data will throw a BadRequestError automatically

        console.log(`Received ${body.activities.length} activities`);
        return {
            success: true,
            message: "Activities received",
            timestamp: new Date().toISOString(),
        };
    }
}
```

## Client-Side Transformation Example

While validation is primarily for server-side, you can still use class-transformer on the client:

```typescript
import { plainToClass } from "class-transformer";
import { GetActivitiesResponse } from "@work-share/types";

async function fetchActivities() {
    const response = await fetch("/activities");
    const plainData = await response.json();

    // Transform to typed class instance
    const typedResponse = plainToClass(GetActivitiesResponse, plainData);

    // Now you have properly typed data with all class methods available
    console.log(`Received ${typedResponse.count} activities`);
    return typedResponse;
}
```

## Common Validation Scenarios

### Valid Data

```typescript
const validActivity = {
    filePath: "/src/index.ts",
    userName: "Alice",
    timestamp: "2026-03-07T10:30:00.000Z",
    action: "open", // Must be "open", "edit", or "close"
    repositoryRemoteUrl: "https://github.com/org/repo.git",
};
// ✅ Passes validation
```

### Invalid Data Examples

```typescript
// ❌ Missing required field
const missingField = {
    userName: "Bob",
    timestamp: "2026-03-07T10:30:00.000Z",
    action: "open",
    repositoryRemoteUrl: "https://github.com/org/repo.git",
    // Missing filePath - will fail validation
};

// ❌ Invalid action value
const invalidEnum = {
    filePath: "/src/app.ts",
    userName: "Charlie",
    timestamp: "2026-03-07T10:30:00.000Z",
    action: "modified", // Should be "open", "edit", or "close"
    repositoryRemoteUrl: "https://github.com/org/repo.git",
};

// ❌ Wrong type
const wrongType = {
    filePath: 123, // Should be string
    userName: "Dave",
    timestamp: "2026-03-07T10:30:00.000Z",
    action: "open",
    repositoryRemoteUrl: "https://github.com/org/repo.git",
};
```

## Handling Validation Errors

```typescript
import { validate, ValidationError } from "class-validator";
import { plainToClass } from "class-transformer";
import { PatchDto } from "@work-share/types";

async function validatePatch(data: any) {
    const patch = plainToClass(PatchDto, data);
    const errors: ValidationError[] = await validate(patch);

    if (errors.length > 0) {
        // Format errors for logging or API response
        const formattedErrors = errors.map((error) => ({
            property: error.property,
            constraints: error.constraints,
            value: error.value,
        }));

        throw new BadRequestError(
            JSON.stringify({
                message: "Validation failed",
                errors: formattedErrors,
            }),
        );
    }

    return patch;
}
```

## Benefits of Using Decorated Classes

1. **Type Safety**: Full TypeScript support
2. **Runtime Validation**: Catch invalid data at runtime
3. **Automatic Transformation**: Plain objects → Class instances
4. **Nested Validation**: Validates complex nested structures
5. **Consistent Validation**: Same rules across extension, server, and client
6. **Self-Documenting**: Decorators show validation rules clearly

## References

- [class-validator documentation](https://github.com/typestack/class-validator)
- [class-transformer documentation](https://github.com/typestack/class-transformer)
- [routing-controllers documentation](https://github.com/typestack/routing-controllers)
