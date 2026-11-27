package com.expenseflow.user;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;

import java.util.List;
import java.util.Optional;

public interface EmployeeRepository extends JpaRepository<Employee, Long> {

    Optional<Employee> findByEmpCode(String empCode);

    List<Employee> findByManagerId(Long managerId);

    @Query("select e from Employee e where e.active = true and e.roles like concat('%', :role, '%') order by e.id")
    List<Employee> findActiveByRole(String role);

    @Query("select e.id from Employee e where e.managerId = :managerId")
    List<Long> findIdsByManagerId(Long managerId);
}
