import { jsPDF } from 'jspdf';


interface Event {
  id: string;
  type: string;
  timestamp: string;
  duration?: number;
  details: string;
  confidence?: number;
  severity: 'low' | 'medium' | 'high';
}

interface ReportData {
  candidateName: string;
  sessionStart: string;
  sessionEnd: string;
  events: Event[];
  summary: {
    totalEvents: number;
    violations: number;
    systemEvents: number;
    objectDetections: number;
  };
}

class ReportGenerator {
  static generateCSV(events: Event[], candidateName: string): string {
    const header = [
      'Timestamp',
      'Event Type', 
      'Details',
      'Duration (seconds)',
      'Confidence',
      'Severity'
    ];

    const rows = events.map(event => [
      event.timestamp,
      event.type,
      event.details,
      event.duration?.toString() || '',
      event.confidence ? (event.confidence * 100).toFixed(1) + '%' : '',
      event.severity
    ]);

    const csvContent = [
      `Candidate: ${candidateName}`,
      `Report Generated: ${new Date().toISOString()}`,
      `Total Events: ${events.length}`,
      '',
      header.join(','),
      ...rows.map(row => row.map(field => `"${field}"`).join(','))
    ].join('\n');

    return csvContent;
  }

  static generatePDF(reportData: ReportData): jsPDF {
    const doc = new jsPDF();
    const pageWidth = doc.internal.pageSize.width;
    const pageHeight = doc.internal.pageSize.height;
    const margin = 20;
    let yPosition = margin;

    // Header
    doc.setFontSize(20);
    doc.setTextColor(33, 85, 153); // Professional blue
    doc.text('Video Interview Proctoring Report', pageWidth / 2, yPosition, { align: 'center' });
    yPosition += 20;

    // Session Info
    doc.setFontSize(12);
    doc.setTextColor(0, 0, 0);
    doc.text(`Candidate: ${reportData.candidateName}`, margin, yPosition);
    yPosition += 8;
    doc.text(`Session Start: ${new Date(reportData.sessionStart).toLocaleString()}`, margin, yPosition);
    yPosition += 8;
    doc.text(`Session End: ${new Date(reportData.sessionEnd).toLocaleString()}`, margin, yPosition);
    yPosition += 8;
    doc.text(`Report Generated: ${new Date().toLocaleString()}`, margin, yPosition);
    yPosition += 15;

    // Summary Section
    doc.setFontSize(14);
    doc.setTextColor(33, 85, 153);
    doc.text('Summary', margin, yPosition);
    yPosition += 10;

    doc.setFontSize(10);
    doc.setTextColor(0, 0, 0);
    doc.text(`Total Events: ${reportData.summary.totalEvents}`, margin, yPosition);
    yPosition += 6;
    doc.text(`Violations: ${reportData.summary.violations}`, margin, yPosition);
    yPosition += 6;
    doc.text(`Object Detections: ${reportData.summary.objectDetections}`, margin, yPosition);
    yPosition += 6;
    doc.text(`System Events: ${reportData.summary.systemEvents}`, margin, yPosition);
    yPosition += 15;

    // Events Section
    doc.setFontSize(14);
    doc.setTextColor(33, 85, 153);
    doc.text('Detailed Events', margin, yPosition);
    yPosition += 10;

    // Events table
    const tableHeaders = ['Time', 'Type', 'Details', 'Severity'];
    const colWidths = [35, 30, 80, 25];
    const startX = margin;

    // Table header
    doc.setFontSize(9);
    doc.setTextColor(255, 255, 255);
    doc.setFillColor(33, 85, 153);
    doc.rect(startX, yPosition, colWidths.reduce((a, b) => a + b), 8, 'F');
    
    let xPos = startX + 2;
    tableHeaders.forEach((header, i) => {
      doc.text(header, xPos, yPosition + 5);
      xPos += colWidths[i];
    });
    yPosition += 8;

    // Table rows
    doc.setTextColor(0, 0, 0);
    reportData.events.slice(0, 30).forEach((event, index) => { // Limit to 30 events for PDF
      if (yPosition > pageHeight - 30) {
        doc.addPage();
        yPosition = margin;
      }

      // Alternate row colors
      if (index % 2 === 0) {
        doc.setFillColor(248, 249, 250);
        doc.rect(startX, yPosition, colWidths.reduce((a, b) => a + b), 6, 'F');
      }

      const timeStr = new Date(event.timestamp).toLocaleTimeString();
      const typeStr = event.type.replace('_', ' ').toUpperCase();
      const detailsStr = event.details.length > 40 ? 
        event.details.substring(0, 37) + '...' : event.details;

      xPos = startX + 2;
      doc.text(timeStr, xPos, yPosition + 4);
      xPos += colWidths[0];
      doc.text(typeStr, xPos, yPosition + 4);
      xPos += colWidths[1];
      doc.text(detailsStr, xPos, yPosition + 4);
      xPos += colWidths[2];
      
      // Color-code severity
      const severityColor = event.severity === 'high' ? [239, 68, 68] as const : 
                           event.severity === 'medium' ? [245, 158, 11] as const : [34, 197, 94] as const;
      doc.setTextColor(severityColor[0], severityColor[1], severityColor[2]);
      doc.text(event.severity.toUpperCase(), xPos, yPosition + 4);
      doc.setTextColor(0, 0, 0);

      yPosition += 6;
    });

    // Footer
    const totalPages = doc.getNumberOfPages();
    for (let i = 1; i <= totalPages; i++) {
      doc.setPage(i);
      doc.setFontSize(8);
      doc.setTextColor(128, 128, 128);
      doc.text(
        `Page ${i} of ${totalPages} - Generated by Video Interview Proctoring System`,
        pageWidth / 2,
        pageHeight - 10,
        { align: 'center' }
      );
    }

    return doc;
  }

  static downloadCSV(events: Event[], candidateName: string): void {
    const csvContent = this.generateCSV(events, candidateName);
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    
    if (link.download !== undefined) {
      const url = URL.createObjectURL(blob);
      link.setAttribute('href', url);
      link.setAttribute('download', `proctoring_report_${candidateName}_${new Date().toISOString().split('T')[0]}.csv`);
      link.style.visibility = 'hidden';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    }
  }

  static downloadPDF(reportData: ReportData): void {
    const doc = this.generatePDF(reportData);
    doc.save(`proctoring_report_${reportData.candidateName}_${new Date().toISOString().split('T')[0]}.pdf`);
  }

  static generateSummary(events: Event[]): ReportData['summary'] {
    return {
      totalEvents: events.length,
      violations: events.filter(e => e.type === 'violation').length,
      systemEvents: events.filter(e => e.type === 'system').length,
      objectDetections: events.filter(e => e.type === 'object_detected').length
    };
  }
}

export default ReportGenerator;