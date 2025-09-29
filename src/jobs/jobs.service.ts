import { Injectable, OnModuleDestroy } from '@nestjs/common';
import puppeteer, { Browser, Page } from 'puppeteer';
import { JobData } from './job.interface';
import { PrismaService } from 'prisma/prisma.service';

@Injectable()
export class JobsService implements OnModuleDestroy {
  constructor(private prisma: PrismaService) {}

  private readonly baseUrl = 'https://123job.vn/tuyen-dung';
  private browser: Browser | null = null;

  private async getBrowser(): Promise<Browser> {
    if (!this.browser) {
      this.browser = await puppeteer.launch({
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox'],
      });
    }
    return this.browser;
  }

  private async crawlJobList(
    jobType: string,
  ): Promise<{ link: string; job_type: string }[]> {
    const browser = await this.getBrowser();
    const page: Page = await browser.newPage();
    const jobs: { link: string; job_type: string }[] = [];
    let pageIndex = 1;

    while (true) {
      const url = `${this.baseUrl}?job_type=${jobType}&page=${pageIndex}`;
      console.log(`Crawling list: ${url}`);

      try {
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 8000 });
      } catch (e) {
        console.warn(`❗ Bỏ qua ${url}: ${e}`);
        break;
      }

      const links = await page.$$eval('.job__list-item-title a', (els) =>
        els.map((a) => a.href),
      );

      if (links.length === 0) break;

      for (const link of links) {
        jobs.push({ link, job_type: jobType });
      }

      if (pageIndex++ > 200) break;
    }

    await page.close();
    return jobs;
  }

  private async crawlJobDetail(
    link: string,
    jobType: string,
  ): Promise<JobData> {
    const browser = await this.getBrowser();
    const page = await browser.newPage();

    await page.goto(link, { waitUntil: 'domcontentloaded', timeout: 10000 });

    const data = await page.evaluate(() => {
      const text = (sel: string) =>
        document.querySelector(sel)?.textContent?.trim() || '';

      const getHtmlContent = (title: string) => {
        const group = Array.from(
          document.querySelectorAll('.content-group'),
        ).find((g) =>
          g
            .querySelector('.content-group__title')
            ?.textContent?.includes(title),
        );
        return (
          group?.querySelector('.content-group__content')?.innerHTML.trim() ??
          ''
        );
      };

      const getAttr = (name: string) => {
        const item = Array.from(document.querySelectorAll('.attr-item')).find(
          (i) => i.querySelector('.name-attr')?.textContent?.includes(name),
        );
        return item?.querySelector('.text-attr')?.textContent?.trim() || '';
      };

      const getSalaryAndLocation = (keyword: string) => {
        const items = Array.from(
          document.querySelectorAll('.attr-item-head .attr-item'),
        );
        for (const item of items) {
          const label = item
            .querySelector('.text span:last-child')
            ?.textContent?.trim();
          if (label?.includes(keyword)) {
            return item.querySelector('.value span')?.textContent?.trim() || '';
          }
        }
        return '';
      };

      return {
        title: text('h1.js-job.job-title'),
        company: text('.company-name h2'),
        salary: getSalaryAndLocation('Mức lương'),
        location: getSalaryAndLocation('Địa điểm'),
        experience: getAttr('Kinh nghiệm'),
        level: getAttr('Cấp bậc'),
        workingForm: getAttr('Hình thức'),
        deadline: getAttr('Hạn nộp'),
        shift: getAttr('Ca làm'),
        degree: getAttr('Trình độ'),
        age: getAttr('Độ tuổi'),
        quantity: getAttr('Số lượng'),
        field: getAttr('Ngành nghề'),
        description: getHtmlContent('Mô tả'),
        requirement: getHtmlContent('Yêu cầu'),
        benefit: getHtmlContent('Quyền lợi'),
        companyLogo:
          (document.querySelector('.company-logo') as HTMLImageElement)?.src ||
          '',
        companySize:
          document
            .querySelector(
              '.company-info-item .company-entity-item:nth-child(1) .text-bold',
            )
            ?.textContent?.trim() || '',
        companyHeadquarters:
          document
            .querySelector(
              '.company-info-item .company-entity-item:nth-child(2) .text-bold',
            )
            ?.textContent?.trim() || '',
        contactName: text('.user-contact-sidebar .name .text-bold'),
        contactPhone:
          document
            .querySelector('.show-phone[data-phone]')
            ?.getAttribute('data-phone') ||
          document
            .querySelector('#phone-employer')
            ?.getAttribute('data-phone') ||
          document.querySelector('#phone-employer')?.textContent?.trim() ||
          '',
      };
    });

    await page.close();
    return { link, job_type: jobType, ...data };
  }

  async crawlAll(jobTypes: string[] = ['1', '2']): Promise<JobData[]> {
    const all: JobData[] = [];

    for (const jt of jobTypes) {
      const list = await this.crawlJobList(jt);
      for (const { link } of list) {
        console.log(`Crawling detail: ${link}`);
        try {
          const detail = await this.crawlJobDetail(link, jt);
          all.push(detail);

          await this.prisma.job.upsert({
            where: { link: detail.link },
            update: { ...detail },
            create: detail,
          });
        } catch (e) {
          console.warn(`❗ Lỗi detail ${link}:`, e);
        }
      }
    }
    return all;
  }

  async onModuleDestroy() {
    if (this.browser) await this.browser.close();
  }

  //tìm kiếm
  async searchFilterPaginate(params: {
    page?: number;
    limit?: number;
    keyword?: string; // search theo title / company
    location?: string;
    job_type?: string;
  }) {
    const { page = 1, limit = 10, keyword, location, job_type } = params;

    const where: Record<string, any> = {};

    if (keyword) {
      where.OR = [
        { title: { contains: keyword, mode: 'insensitive' } },
        { company: { contains: keyword, mode: 'insensitive' } },
      ];
    }

    if (location) {
      where.location = { contains: location, mode: 'insensitive' };
    }

    if (job_type) {
      where.job_type = job_type;
    }

    const data = await this.prisma.job.findMany({
      where,
      skip: (page - 1) * limit,
      take: limit,
    });

    const total = await this.prisma.job.count({ where });

    return {
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
      data,
    };
  }
}
