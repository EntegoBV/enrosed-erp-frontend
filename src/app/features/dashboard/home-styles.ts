import { ChangeDetectionStrategy, Component, ViewEncapsulation } from '@angular/core';

/*
 * The home's four style partials (src/styles/home-*.scss) load with the home
 * routes - /dashboard, its Agenda and Open punten - instead of in the initial
 * bundle. The foundation leaves the 1 MB initial budget at 999.9 kB
 * (AI-CONTEXT "Initial bundle budget"); with the partials in styles.scss the
 * production build failed by 4 kB, and they are about 39 kB minified.
 *
 * Every route page renders <app-home-styles hidden /> as its FIRST child, so
 * the rules are added before the page's own components' styles, as they came
 * before every component style in styles.css (a tie such as
 * .home-desk__more .search-summary still goes to the component). One
 * carrier per partial keeps each under the 16 kB component-style warning;
 * ViewEncapsulation.None keeps the rules global while a home route is on
 * screen, exactly as they were (the partials only style home classes and the
 * .shell--home tab bar, which app.ts sets on /dashboard alone). Angular adds
 * them before the page's first paint and removes them when the last home
 * page leaves. The partials stay plain global SCSS files: never :host here.
 */

@Component({
  selector: 'app-home-widget-styles', template: '', changeDetection: ChangeDetectionStrategy.OnPush,
  encapsulation: ViewEncapsulation.None, styleUrl: '../../../styles/home-widgets.scss',
})
export class HomeWidgetStyles {}

@Component({
  selector: 'app-home-desk-styles', template: '', changeDetection: ChangeDetectionStrategy.OnPush,
  encapsulation: ViewEncapsulation.None, styleUrl: '../../../styles/home-desk.scss',
})
export class HomeDeskStyles {}

@Component({
  selector: 'app-home-phone-styles', template: '', changeDetection: ChangeDetectionStrategy.OnPush,
  encapsulation: ViewEncapsulation.None, styleUrl: '../../../styles/home-phone.scss',
})
export class HomePhoneStyles {}

@Component({
  selector: 'app-home-agenda-styles', template: '', changeDetection: ChangeDetectionStrategy.OnPush,
  encapsulation: ViewEncapsulation.None, styleUrl: '../../../styles/home-agenda.scss',
})
export class HomeAgendaStyles {}

/** The home's styles, for a home route page: `<app-home-styles hidden />` as its first child (never in the layout). */
@Component({
  selector: 'app-home-styles',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [HomeWidgetStyles, HomeDeskStyles, HomePhoneStyles, HomeAgendaStyles],
  template: '<app-home-widget-styles /><app-home-desk-styles /><app-home-phone-styles /><app-home-agenda-styles />',
})
export class HomeStyles {}
