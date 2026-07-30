import { courtDocketScraper } from './court-docket';
import { cookCountyTaxScraper } from './cook-county-tax';
import { mrCooperScraper } from './mr-cooper';
import { peoplesGasScraper } from './peoples-gas';
import { comedScraper } from './comed';
import { courtNameSearchScraper } from './court-name-search';
import { appfolioHoaScraper } from './appfolio-hoa';
import { googleDriveScraper } from './google-drive';
import { nwRegisteredAgentScraper } from './nw-registered-agent';
import { flRegisteredAgentScraper } from './fl-registered-agent';
import { wyomingSOSScraper } from './wyoming-sos';
import { browseAIScraper } from './browse-ai';
import { ilSOSScraper } from './il-sos';
import { flSunbizScraper } from './fl-sunbiz';
import { cookCountyRecorderScraper } from './cook-county-recorder';
import { cookCountyAssessorScraper } from './cook-county-assessor';
import { colombiaVurScraper } from './colombia-vur';
import { firecrawlTarget } from './firecrawl';

export const allTargets = [
  courtDocketScraper,
  cookCountyTaxScraper,
  mrCooperScraper,
  peoplesGasScraper,
  comedScraper,
  courtNameSearchScraper,
  appfolioHoaScraper,
  googleDriveScraper,
  nwRegisteredAgentScraper,
  flRegisteredAgentScraper,
  wyomingSOSScraper,
  browseAIScraper,
  ilSOSScraper,
  flSunbizScraper,
  cookCountyRecorderScraper,
  cookCountyAssessorScraper,
  colombiaVurScraper,
  firecrawlTarget
];
