"""Planning pay costs. Salary allocation is not a payroll calculation."""

from __future__ import annotations

from calendar import monthrange
from datetime import date, timedelta

from mital_solver.schemas import Employee, Instance


def regular_cost(inst: Instance, employee: Employee, hours: float) -> float:
    if inst.pay_basis == "hourly":
        return employee.wage * hours

    assert employee.monthly_salary is not None
    first = date.fromisoformat(inst.start_date)
    days = (first + timedelta(days=offset) for offset in range(inst.horizon_days))
    return employee.monthly_salary * sum(
        1 / monthrange(day.year, day.month)[1] for day in days
    )
