import { Controller, Get, Query } from '@nestjs/common';
import { JobsService } from './jobs.service';
import { JobData } from './job.interface';

@Controller()
export class JobsController {
  constructor(private readonly jobsService: JobsService) {}

  @Get('crawl')
  async crawlJobs(@Query('jobType') jobType?: string): Promise<JobData[]> {
    const types = jobType ? [jobType] : ['1', '2'];
    return this.jobsService.crawlAll(types);
  }

  @Get('job')
  async searchJobs(
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('keyword') keyword?: string,
    @Query('location') location?: string,
    @Query('job_type') job_type?: string,
  ) {
    return this.jobsService.searchFilterPaginate({
      page: page ? Number(page) : 1,
      limit: limit ? Number(limit) : 10,
      keyword,
      location,
      job_type,
    });
  }
}
