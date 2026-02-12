/**
 * PatternDetector for OpenClaw Rate Limit Manager
 *
 * Analyzes usage patterns to optimize rate limits and predict future usage.
 * Learns from historical data to provide intelligent recommendations (Pro tier feature).
 */

import { randomUUID } from 'crypto';

/**
 * PatternDetector class
 * Detects and learns usage patterns for optimal rate limit management
 */
export class PatternDetector {
  constructor(storage) {
    this.storage = storage;

    // Pattern detection thresholds
    this.minEventsForPattern = 10;        // Need 10+ events to detect pattern
    this.minPatternConfidence = 0.6;      // 60% confidence minimum
    this.burstThreshold = 1.0;            // Coefficient of variation threshold for burst detection
    this.peakThresholdMultiplier = 1.5;   // Peak hours must be 1.5x average
  }

  /**
   * Analyze recent usage and detect patterns
   * @param {string} agentWallet - Agent wallet address
   * @param {number} lookbackDays - Days of history to analyze (default: 7)
   * @returns {Promise<object>} Analysis results with detected patterns
   */
  async analyzeUsage(agentWallet, lookbackDays = 7) {
    try {
      // Get recent events
      const events = await this.getRecentEvents(agentWallet, lookbackDays);

      if (events.length < this.minEventsForPattern) {
        return {
          patterns: [],
          confidence: 0,
          message: `Not enough data (${events.length}/${this.minEventsForPattern} events required)`
        };
      }

      const patterns = [];

      // Detect time-of-day patterns
      const hourlyPattern = this.analyzeHourlyDistribution(events);
      if (hourlyPattern.confidence >= this.minPatternConfidence) {
        patterns.push(hourlyPattern);
        await this.storePattern(agentWallet, hourlyPattern);
      }

      // Detect day-of-week patterns
      const weeklyPattern = this.analyzeWeeklyPattern(events);
      if (weeklyPattern.confidence >= this.minPatternConfidence) {
        patterns.push(weeklyPattern);
        await this.storePattern(agentWallet, weeklyPattern);
      }

      // Detect burst vs steady patterns
      const burstPattern = this.detectBurstPattern(events);
      if (burstPattern.confidence >= this.minPatternConfidence) {
        patterns.push(burstPattern);
        await this.storePattern(agentWallet, burstPattern);
      }

      // Calculate overall confidence
      const overallConfidence = this.calculateOverallConfidence(patterns);

      console.log(`[PatternDetector] Analyzed ${events.length} events, found ${patterns.length} patterns (confidence: ${(overallConfidence * 100).toFixed(1)}%)`);

      return {
        patterns,
        confidence: overallConfidence,
        events_analyzed: events.length,
        lookback_days: lookbackDays
      };
    } catch (error) {
      console.error('[PatternDetector] Error analyzing usage:', error);
      return {
        patterns: [],
        confidence: 0,
        error: error.message
      };
    }
  }

  /**
   * Get recent rate limit events
   * @param {string} agentWallet - Agent wallet address
   * @param {number} days - Days of history
   * @returns {Promise<Array>} Array of events
   */
  async getRecentEvents(agentWallet, days) {
    try {
      const stmt = this.storage.db.prepare(`
        SELECT * FROM rate_limit_events
        WHERE agent_wallet = ?
          AND timestamp > datetime('now', '-' || ? || ' days')
        ORDER BY timestamp DESC
      `);

      return stmt.all(agentWallet, days);
    } catch (error) {
      console.error('[PatternDetector] Error getting recent events:', error);
      return [];
    }
  }

  /**
   * Analyze hourly distribution to find peak usage times
   * @param {Array} events - Array of events
   * @returns {object} Hourly pattern analysis
   */
  analyzeHourlyDistribution(events) {
    const hourCounts = new Array(24).fill(0);

    // Count events per hour
    for (const event of events) {
      const hour = new Date(event.timestamp).getHours();
      hourCounts[hour]++;
    }

    // Calculate average
    const avgCount = hourCounts.reduce((a, b) => a + b, 0) / 24;

    // Find peak hours (above threshold)
    const peakHours = [];
    const peakCounts = [];

    for (let hour = 0; hour < 24; hour++) {
      if (hourCounts[hour] > avgCount * this.peakThresholdMultiplier) {
        peakHours.push(hour);
        peakCounts.push(hourCounts[hour]);
      }
    }

    // Calculate peak requests per minute
    const maxHourlyCount = Math.max(...hourCounts);
    const peakRPM = Math.ceil(maxHourlyCount / 60);

    // Determine time windows
    const timeWindows = this.categorizeTimeWindows(peakHours);

    // Calculate confidence
    const variance = this.calculateVariance(hourCounts, avgCount);
    const confidence = peakHours.length > 0
      ? Math.min(1.0, variance / avgCount * 0.5 + 0.3)
      : 0.3;

    return {
      pattern_type: 'time_of_day',
      description: peakHours.length > 0
        ? `Peak usage during hours: ${peakHours.join(', ')}`
        : 'Uniform usage throughout day',
      peak_hours: peakHours,
      typical_windows: timeWindows,
      avg_requests_per_minute: Math.ceil(avgCount / 60),
      peak_requests_per_minute: peakRPM,
      suggested_limit: Math.ceil(peakRPM * 1.2), // 20% buffer
      confidence,
      data: {
        hourly_distribution: hourCounts,
        avg_hourly: avgCount.toFixed(1),
        max_hourly: maxHourlyCount
      }
    };
  }

  /**
   * Categorize peak hours into time windows
   * @param {Array} peakHours - Array of peak hour numbers
   * @returns {Array} Time window labels
   */
  categorizeTimeWindows(peakHours) {
    const windows = [];

    if (peakHours.some(h => h >= 6 && h < 12)) {
      windows.push('morning');
    }
    if (peakHours.some(h => h >= 12 && h < 18)) {
      windows.push('afternoon');
    }
    if (peakHours.some(h => h >= 18 && h < 24)) {
      windows.push('evening');
    }
    if (peakHours.some(h => h >= 0 && h < 6)) {
      windows.push('night');
    }

    return windows;
  }

  /**
   * Analyze weekly pattern (day-of-week usage)
   * @param {Array} events - Array of events
   * @returns {object} Weekly pattern analysis
   */
  analyzeWeeklyPattern(events) {
    const dayCounts = new Array(7).fill(0);
    const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

    // Count events per day of week
    for (const event of events) {
      const day = new Date(event.timestamp).getDay();
      dayCounts[day]++;
    }

    // Calculate average
    const avgCount = dayCounts.reduce((a, b) => a + b, 0) / 7;

    // Find peak days
    const peakDays = [];
    for (let day = 0; day < 7; day++) {
      if (dayCounts[day] > avgCount * this.peakThresholdMultiplier) {
        peakDays.push(dayNames[day]);
      }
    }

    // Categorize weekday vs weekend
    const weekdayTotal = dayCounts.slice(1, 6).reduce((a, b) => a + b, 0);
    const weekendTotal = dayCounts[0] + dayCounts[6];
    const isWeekdayHeavy = weekdayTotal > weekendTotal * 1.5;
    const isWeekendHeavy = weekendTotal > weekdayTotal * 1.5;

    // Calculate confidence
    const variance = this.calculateVariance(dayCounts, avgCount);
    const confidence = peakDays.length > 0
      ? Math.min(1.0, variance / avgCount * 0.4 + 0.4)
      : 0.3;

    let description = 'Uniform usage across week';
    if (isWeekdayHeavy) {
      description = 'Weekday-heavy usage pattern';
    } else if (isWeekendHeavy) {
      description = 'Weekend-heavy usage pattern';
    } else if (peakDays.length > 0) {
      description = `Peak usage on: ${peakDays.join(', ')}`;
    }

    return {
      pattern_type: 'day_of_week',
      description,
      peak_days: peakDays,
      is_weekday_heavy: isWeekdayHeavy,
      is_weekend_heavy: isWeekendHeavy,
      confidence,
      data: {
        daily_distribution: dayCounts.map((count, idx) => ({
          day: dayNames[idx],
          count
        })),
        avg_daily: avgCount.toFixed(1)
      }
    };
  }

  /**
   * Detect burst vs steady traffic pattern
   * @param {Array} events - Array of events
   * @returns {object} Burst pattern analysis
   */
  detectBurstPattern(events) {
    if (events.length < 2) {
      return {
        pattern_type: 'burst',
        description: 'Insufficient data',
        confidence: 0
      };
    }

    // Sort events by timestamp
    const sortedEvents = [...events].sort((a, b) =>
      new Date(a.timestamp) - new Date(b.timestamp)
    );

    // Calculate inter-arrival times (in milliseconds)
    const intervals = [];
    for (let i = 1; i < sortedEvents.length; i++) {
      const interval = new Date(sortedEvents[i].timestamp) - new Date(sortedEvents[i - 1].timestamp);
      intervals.push(interval);
    }

    // Calculate mean and variance
    const avgInterval = intervals.reduce((a, b) => a + b, 0) / intervals.length;
    const variance = this.calculateVariance(intervals, avgInterval);
    const stdDev = Math.sqrt(variance);

    // Coefficient of Variation (CV) = stdDev / mean
    const coefficientOfVariation = avgInterval > 0 ? stdDev / avgInterval : 0;

    // Determine pattern type
    const isBursty = coefficientOfVariation > this.burstThreshold;
    const isSteady = coefficientOfVariation < 0.5;

    // Calculate recommended queue size
    let recommendedQueueSize = 10; // Default
    if (coefficientOfVariation > 2.0) {
      recommendedQueueSize = 100; // High burst
    } else if (coefficientOfVariation > 1.5) {
      recommendedQueueSize = 50;  // Moderate burst
    } else if (coefficientOfVariation > 1.0) {
      recommendedQueueSize = 25;  // Low burst
    }

    // Calculate confidence
    const confidence = Math.min(1.0, Math.abs(coefficientOfVariation - 1.0) * 0.5 + 0.4);

    let description = 'Unknown traffic pattern';
    if (isBursty) {
      description = 'Bursty traffic pattern detected - requests come in bursts with quiet periods';
    } else if (isSteady) {
      description = 'Steady traffic pattern - consistent request rate over time';
    } else {
      description = 'Mixed traffic pattern - combination of bursts and steady flow';
    }

    return {
      pattern_type: 'burst',
      description,
      is_bursty: isBursty,
      is_steady: isSteady,
      coefficient_of_variation: parseFloat(coefficientOfVariation.toFixed(2)),
      avg_interval_ms: Math.round(avgInterval),
      suggested_queue_size: recommendedQueueSize,
      confidence,
      data: {
        interval_stats: {
          mean: Math.round(avgInterval),
          std_dev: Math.round(stdDev),
          min: Math.min(...intervals),
          max: Math.max(...intervals)
        }
      }
    };
  }

  /**
   * Calculate variance
   * @param {Array} values - Array of numbers
   * @param {number} mean - Mean value
   * @returns {number} Variance
   */
  calculateVariance(values, mean) {
    if (values.length === 0) return 0;

    const squaredDiffs = values.map(val => Math.pow(val - mean, 2));
    return squaredDiffs.reduce((a, b) => a + b, 0) / values.length;
  }

  /**
   * Calculate overall confidence from multiple patterns
   * @param {Array} patterns - Array of pattern objects
   * @returns {number} Overall confidence (0.0 to 1.0)
   */
  calculateOverallConfidence(patterns) {
    if (patterns.length === 0) return 0;

    const avgConfidence = patterns.reduce((sum, p) => sum + p.confidence, 0) / patterns.length;

    // Boost confidence slightly if multiple patterns detected
    const multiPatternBonus = patterns.length > 1 ? 0.1 : 0;

    return Math.min(1.0, avgConfidence + multiPatternBonus);
  }

  /**
   * Store detected pattern in database
   * @param {string} agentWallet - Agent wallet address
   * @param {object} pattern - Pattern object
   * @returns {Promise<void>}
   */
  async storePattern(agentWallet, pattern) {
    try {
      const patternId = randomUUID();

      const stmt = this.storage.db.prepare(`
        INSERT INTO usage_patterns (
          pattern_id, agent_wallet, pattern_type,
          avg_requests_per_minute, peak_requests_per_minute,
          typical_window, confidence,
          suggested_limit, suggested_queue_size
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      stmt.run(
        patternId,
        agentWallet,
        pattern.pattern_type,
        pattern.avg_requests_per_minute || null,
        pattern.peak_requests_per_minute || null,
        pattern.typical_windows?.join(',') || pattern.description,
        pattern.confidence,
        pattern.suggested_limit || null,
        pattern.suggested_queue_size || null
      );

      console.log(`[PatternDetector] Stored pattern ${patternId}: ${pattern.pattern_type} (confidence: ${(pattern.confidence * 100).toFixed(1)}%)`);
    } catch (error) {
      console.error('[PatternDetector] Error storing pattern:', error);
    }
  }

  /**
   * Get stored patterns for an agent
   * @param {string} agentWallet - Agent wallet address
   * @param {number} limit - Maximum number of patterns to return
   * @returns {Promise<Array>} Array of patterns
   */
  async getStoredPatterns(agentWallet, limit = 10) {
    try {
      const stmt = this.storage.db.prepare(`
        SELECT * FROM usage_patterns
        WHERE agent_wallet = ?
        ORDER BY confidence DESC, detected_at DESC
        LIMIT ?
      `);

      return stmt.all(agentWallet, limit);
    } catch (error) {
      console.error('[PatternDetector] Error getting stored patterns:', error);
      return [];
    }
  }

  /**
   * Predict future usage based on patterns
   * @param {string} agentWallet - Agent wallet address
   * @returns {Promise<object>} Usage predictions
   */
  async predictUsage(agentWallet) {
    try {
      const patterns = await this.getStoredPatterns(agentWallet, 5);

      if (patterns.length === 0) {
        return {
          prediction: 'insufficient_data',
          message: 'Not enough historical data to predict usage'
        };
      }

      // Find highest confidence pattern
      const primaryPattern = patterns.reduce((best, current) =>
        current.confidence > best.confidence ? current : best
      );

      const now = new Date();
      const currentHour = now.getHours();
      const currentDay = now.getDay();

      // Build prediction
      const prediction = {
        timestamp: now.toISOString(),
        current_hour: currentHour,
        current_day: currentDay,
        primary_pattern: primaryPattern.pattern_type,
        confidence: primaryPattern.confidence,
        recommendations: []
      };

      // Time-based recommendations
      if (primaryPattern.pattern_type === 'time_of_day' && primaryPattern.typical_window) {
        const windows = primaryPattern.typical_window.split(',');
        const currentWindow = this.getCurrentTimeWindow(currentHour);

        if (windows.includes(currentWindow)) {
          prediction.recommendations.push({
            type: 'peak_period',
            message: `Currently in peak usage window (${currentWindow})`,
            suggested_limit: primaryPattern.suggested_limit,
            action: 'Consider increasing rate limits temporarily'
          });
        } else {
          prediction.recommendations.push({
            type: 'off_peak',
            message: `Currently in off-peak period`,
            action: 'Normal rate limits should be sufficient'
          });
        }
      }

      // Burst pattern recommendations
      const burstPattern = patterns.find(p => p.pattern_type === 'burst');
      if (burstPattern && burstPattern.suggested_queue_size) {
        prediction.recommendations.push({
          type: 'queue_sizing',
          message: `Bursty traffic detected`,
          suggested_queue_size: burstPattern.suggested_queue_size,
          action: `Consider queue size of ${burstPattern.suggested_queue_size}`
        });
      }

      return prediction;
    } catch (error) {
      console.error('[PatternDetector] Error predicting usage:', error);
      return {
        prediction: 'error',
        error: error.message
      };
    }
  }

  /**
   * Get current time window (morning, afternoon, evening, night)
   * @param {number} hour - Hour (0-23)
   * @returns {string} Time window
   */
  getCurrentTimeWindow(hour) {
    if (hour >= 6 && hour < 12) return 'morning';
    if (hour >= 12 && hour < 18) return 'afternoon';
    if (hour >= 18 && hour < 24) return 'evening';
    return 'night';
  }

  /**
   * Clean up old patterns (maintenance task)
   * @param {number} maxAgeDays - Maximum age in days
   * @returns {Promise<number>} Number of patterns deleted
   */
  async cleanupOldPatterns(maxAgeDays = 30) {
    try {
      const stmt = this.storage.db.prepare(`
        DELETE FROM usage_patterns
        WHERE detected_at < datetime('now', '-' || ? || ' days')
      `);

      const result = stmt.run(maxAgeDays);

      if (result.changes > 0) {
        console.log(`[PatternDetector] Cleaned up ${result.changes} old patterns (older than ${maxAgeDays} days)`);
      }

      return result.changes;
    } catch (error) {
      console.error('[PatternDetector] Error cleaning up patterns:', error);
      return 0;
    }
  }

  /**
   * Get pattern insights summary
   * @param {string} agentWallet - Agent wallet address
   * @returns {Promise<object>} Pattern insights
   */
  async getInsights(agentWallet) {
    try {
      const patterns = await this.getStoredPatterns(agentWallet);
      const prediction = await this.predictUsage(agentWallet);

      const insights = {
        total_patterns: patterns.length,
        patterns_by_type: {},
        highest_confidence: 0,
        recommendations: prediction.recommendations || [],
        current_prediction: prediction
      };

      // Aggregate by type
      for (const pattern of patterns) {
        if (!insights.patterns_by_type[pattern.pattern_type]) {
          insights.patterns_by_type[pattern.pattern_type] = 0;
        }
        insights.patterns_by_type[pattern.pattern_type]++;
        insights.highest_confidence = Math.max(insights.highest_confidence, pattern.confidence);
      }

      return insights;
    } catch (error) {
      console.error('[PatternDetector] Error getting insights:', error);
      return {
        total_patterns: 0,
        patterns_by_type: {},
        highest_confidence: 0,
        recommendations: [],
        error: error.message
      };
    }
  }
}
