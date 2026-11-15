import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { api } from './api.config';
import { LOGIN_REQUEST_PAGE_SIZE } from '../../features/login-requests/login-request-state';

export type LoginRequestStatus = 'PENDING' | 'APPROVED' | 'REJECTED';
/** QUOTE = tick box in a quote request, ORDER_SCREEN = the login form, NEW_LINK = forgotten password. */
export type LoginRequestSource = 'QUOTE' | 'ORDER_SCREEN' | 'NEW_LINK';
export type CustomerLoginStatus = 'INVITED' | 'ACTIVE' | 'DISABLED';

/**
 * A later request for the same e-mail while the first one is still open.
 * An entry with source NEW_LINK is only a marker ("the holder of the login
 * asked for a new link meanwhile") and carries nothing but `at`.
 */
export interface LoginRequestLaterSubmission {
  at: string;
  source: LoginRequestSource;
  companyName: string | null;
  companyCountryCode: string | null;
  vatNumber: string | null;
  contactName: string | null;
  phone: string | null;
  message: string | null;
  language: string | null;
  customerId: number | null;
  salesOrderId: number | null;
  salesOrderNumber: string | null;
}

export interface LoginRequest {
  id: number;
  reference: string;
  status: LoginRequestStatus;
  source: LoginRequestSource;
  language: string;
  companyName: string;
  companyCountryCode: string | null;
  vatNumber: string | null;
  contactName: string | null;
  email: string;
  phone: string | null;
  message: string | null;
  customerId: number | null;
  customerCompany: string | null;
  salesOrderId: number | null;
  salesOrderNumber: string | null;
  accountId: number | null;
  repeatCount: number;
  /** A login in status INVITED or ACTIVE exists for this e-mail; a withdrawn one does not count. */
  hasExistingLogin: boolean;
  previouslyRejected: boolean;
  /** Kept beside the first request, in arrival order; never overwritten. */
  laterSubmissions: LoginRequestLaterSubmission[];
  /** More differing repeats came in than the five that are kept. */
  laterSubmissionsFull: boolean;
  createdAt: string;
  decidedAt: string | null;
  decidedBy: string | null;
  decisionNote: string | null;
}

/** A website login of a customer; the password never reaches the ERP. */
export interface CustomerLogin {
  id: number;
  customerId: number;
  customerCompany: string;
  email: string;
  contactName: string | null;
  language: string;
  status: CustomerLoginStatus;
  passwordSetAt: string | null;
  lastLoginAt: string | null;
  lastLinkSentAt: string | null;
  lastLinkError: string | null;
  /** Expiry of the unused one-time link, or null when there is none. */
  linkExpiresAt: string | null;
  createdAt: string;
  createdBy: string | null;
  disabledAt: string | null;
  disabledBy: string | null;
  activeSessions: number;
  /** The latest moment the login was in use (activity, login, session); null when never. */
  lastActiveAt?: string | null;
  /** Visits in the last 30 days. */
  recentVisits?: number;
}

/**
 * What a logged-in customer did (CustomerLoginActivity.Kind on the server): ACTIVATION = password chosen with
 * the link (logs in), LOGIN, LOGOUT, PAGE = a page restored the login, PRICES = own prices on a product page,
 * ORDER_PAGE = order page, ORDER / ORDER_CHANGE / ORDER_CANCEL, ORDERS = Mijn bestellingen, PDF, SEEN = a
 * moment of use known from before the measuring started.
 */
export type LoginActivityKind = 'ACTIVATION' | 'LOGIN' | 'LOGOUT' | 'PAGE' | 'PRICES' | 'ORDER_PAGE' | 'ORDER'
  | 'ORDER_CHANGE' | 'ORDER_CANCEL' | 'ORDERS' | 'PDF' | 'SEEN' | 'OTHER';
export type LoginDevice = 'MOBILE' | 'TABLET' | 'DESKTOP';

/** One login and its use in the period; lastActiveAt is of any age. */
export interface LoginActivityLogin {
  accountId: number;
  customerId: number;
  company: string | null;
  email: string;
  status: CustomerLoginStatus;
  createdAt: string | null;
  activatedAt: string | null;
  lastActiveAt: string | null;
  linkSentAt: string | null;
  linkExpiresAt: string | null;
  visits: number;
  seconds: number;
  measuredVisits: number;
  orderIds: number[];
  kinds: LoginActivityKind[];
  device: LoginDevice | null;
}

/** One visit: rows of one login with less than 30 minutes between them. seconds is null when only its moment is known. */
export interface LoginActivityVisit {
  accountId: number;
  customerId: number;
  company: string | null;
  email: string | null;
  start: string;
  end: string;
  seconds: number | null;
  actions: number;
  startKind: 'ACTIVATION' | 'LOGIN' | 'RETURN';
  kinds: LoginActivityKind[];
  device: LoginDevice | null;
  history: boolean;
  loggedOut: boolean;
  orderIds: number[];
}

/** Analyses › Bezoekers › Klantlogins for days 1, 7, 30, 90 or 365 (Belgian days, ending now). */
export interface LoginActivityReport {
  days: number;
  from: string;
  to: string;
  generatedAt: string;
  accountId: number | null;
  /** The first measured row: visits before it have no length. */
  measuredSince: string | null;
  totals: {
    customers: number;
    visits: number;
    seconds: number;
    measuredVisits: number;
    ordersPlaced: number;
    activeNow: number;
    loginsActive: number;
    loginsInvited: number;
    loginsWithdrawn: number;
  };
  previous: { customers: number; visits: number; seconds: number; ordersPlaced: number };
  perDay: { date: string; customers: number; visits: number }[];
  logins: LoginActivityLogin[];
  visits: LoginActivityVisit[];
  visitsCut: boolean;
}

/** What happened to the mail with the one-time link. */
export interface LoginInvitation {
  sent: boolean;
  expiresAt: string | null;
  error: string | null;
}

export interface LoginRequestMatch {
  customerId: number;
  company: string;
  contact: string | null;
  email: string | null;
  vatNumber: string | null;
  countryCode: string | null;
  city: string | null;
  matchedOn: ('LOGIN' | 'QUOTE' | 'EMAIL' | 'VAT')[];
  logins: { id: number; email: string; status: CustomerLoginStatus }[];
}

export interface LoginRequestDetail {
  request: LoginRequest;
  matches: LoginRequestMatch[];
  /** The login for the request e-mail in any status; for a decided request its own login. */
  existingAccount: CustomerLogin | null;
}

/** Exactly one of customerId / newCustomer; both null for a NEW_LINK request. */
export interface ApproveLoginRequest {
  customerId: number | null;
  newCustomer: {
    company: string;
    vatNumber: string;
    countryCode: string;
    contact: string;
    phone: string;
    language: string;
  } | null;
  confirmEmailMismatch: boolean;
}

/** Staff side of the website logins: the request inbox and the logins per customer. */
@Injectable({ providedIn: 'root' })
export class LoginRequestApi {
  private readonly http = inject(HttpClient);

  /* ---------------------------------------------------------- aanvragen */

  /** Open requests come oldest first, decided ones newest decision first. */
  list(status: LoginRequestStatus, page: number): Promise<LoginRequest[]> {
    return firstValueFrom(this.http.get<LoginRequest[]>(api('/api/login-requests'), {
      params: { status, page, size: LOGIN_REQUEST_PAGE_SIZE },
    }));
  }

  detail(id: number): Promise<LoginRequestDetail> {
    return firstValueFrom(this.http.get<LoginRequestDetail>(api(`/api/login-requests/${id}`)));
  }

  approve(id: number, body: ApproveLoginRequest): Promise<{ request: LoginRequest; account: CustomerLogin; invitation: LoginInvitation }> {
    return firstValueFrom(this.http.post<{ request: LoginRequest; account: CustomerLogin; invitation: LoginInvitation }>(
      api(`/api/login-requests/${id}/approve`), body));
  }

  /** The note is internal; the applicant gets no message. */
  reject(id: number, note: string | null): Promise<LoginRequest> {
    return firstValueFrom(this.http.post<LoginRequest>(api(`/api/login-requests/${id}/reject`), { note }));
  }

  /* ------------------------------------------------------------- logins */

  logins(customerId: number): Promise<CustomerLogin[]> {
    return firstValueFrom(this.http.get<CustomerLogin[]>(api('/api/customer-logins'), { params: { customerId } }));
  }

  /** A login without a request; a null e-mail uses the customer's own. */
  grantLogin(customerId: number, email: string | null): Promise<{ account: CustomerLogin; invitation: LoginInvitation }> {
    return firstValueFrom(this.http.post<{ account: CustomerLogin; invitation: LoginInvitation }>(
      api('/api/customer-logins'), { customerId, email }));
  }

  sendLink(accountId: number): Promise<{ account: CustomerLogin; invitation: LoginInvitation }> {
    return firstValueFrom(this.http.post<{ account: CustomerLogin; invitation: LoginInvitation }>(
      api(`/api/customer-logins/${accountId}/invitation`), null));
  }

  withdraw(accountId: number): Promise<CustomerLogin> {
    return firstValueFrom(this.http.post<CustomerLogin>(api(`/api/customer-logins/${accountId}/withdraw`), null));
  }

  /* ----------------------------------------------------------- gebruik */

  /** Who used their login when, and for how long; one login with accountId. */
  activity(days: number, accountId: number | null): Promise<LoginActivityReport> {
    const params: Record<string, number> = { days };
    if (accountId !== null) params['accountId'] = accountId;
    return firstValueFrom(this.http.get<LoginActivityReport>(api('/api/customer-logins/activity'), { params }));
  }
}
