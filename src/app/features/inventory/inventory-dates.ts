import { Pipe, PipeTransform } from '@angular/core';
import { dateText, dateTimeText } from './inventory-closing';

/**
 * Dates of the Jaarinventaris, always in the Belgian zone.
 *
 * The server draws the cut-off of a closing and prints the count report and
 * the files in Europe/Brussels. The shared date pipes follow the device, so
 * on a device set to another zone a count booked around midnight would show
 * another day on screen than in the PDF. Every instant of this area goes
 * through these two pipes instead; a plain date (yyyy-MM-dd) reads the same.
 */
@Pipe({ name: 'brusselsDate' })
export class BrusselsDatePipe implements PipeTransform {
  transform(value: string | null | undefined): string {
    return dateText(value);
  }
}

/** "08/10/2026 14:32" in Brussels time. */
@Pipe({ name: 'brusselsDateTime' })
export class BrusselsDateTimePipe implements PipeTransform {
  transform(value: string | null | undefined): string {
    return dateTimeText(value);
  }
}
