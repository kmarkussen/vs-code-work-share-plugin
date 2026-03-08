import { IsArray, ValidateNested } from "class-validator";
import { Type } from "class-transformer";
import { ActivityDto } from "./ActivityDto";

/**
 * Request wrapper for bulk activity ingestion.
 */
export class ActivityBatchDto {
    @IsArray()
    @ValidateNested({ each: true })
    @Type(() => ActivityDto)
    activities!: ActivityDto[];
}
