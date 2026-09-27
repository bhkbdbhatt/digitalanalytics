Feature: Advisor Site Investments Section Fund Detail Page
  This is a feature file that tests Adobe Analytics for Advisor site Product Selector section for Fund Detail Page

  Background: Setup
    Given Set the default to "advisor" site
    And Set the default analytics provider to "Adobe Analytics"

  @advisor @advisorInvestments @smoke @productSelector @advisorFundDetail
  Scenario: Adobe Analytics test values on Advisor Product Selector page load
    When I navigate to the "productSelector" page
    And I wait for 5 seconds
    Then Analytics should be triggered
    And "Adobe Analytics" Provider should be triggered 1 time
    And Provider should have "Page name" key and "investments > Product Selector" value
